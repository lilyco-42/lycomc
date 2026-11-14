//! 微软正版登录（OAuth 2.0 设备码）+ 皮肤资料查询。
//!
//! 全部按公开的 Microsoft / Xbox Live / Minecraft Services 标准 HTTP 协议
//! 用 Rust 自行实现，只对照行为，不复制 PCL / HMCL / Prism 的源码或资源。
//! 链路：devicecode → token(轮询) → XBL → XSTS → login_with_xbox →
//!       entitlements/mcstore（正版校验） → minecraft/profile（角色与皮肤）。
//!
//! 凭据只写 accounts.json；Account 的 Serialize 故意不输出 token，
//! 因此 /api/state、/api/accounts、CLI 输出都不会泄露 access/refresh token。

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use crate::jobs::now_ms;
use crate::settings::{self, Account};

/// 公开的 Azure 应用 id（SJMCL 开源常量，实测 devicecode 返回 200）。
/// 生产分发应注册自有应用并用 LYCOMC_MS_CLIENT_ID 覆盖。
const DEFAULT_CLIENT_ID: &str = "b2468fd2-7996-4f42-8857-5b65d834ef5c";
const SCOPE: &str = "XboxLive.signin offline_access";
const DEVICE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const ENTITLEMENTS_URL: &str = "https://api.minecraftservices.com/entitlements/mcstore";
const PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
const MOJANG_NAME_URL: &str = "https://api.mojang.com/users/profiles/minecraft";
const SESSION_URL: &str = "https://sessionserver.mojang.com/session/minecraft/profile";

pub fn client_id() -> String {
    std::env::var("LYCOMC_MS_CLIENT_ID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string())
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("lycomc/0.1")
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default()
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 表单 POST；OAuth 的 400 也带 JSON body，因此不按状态码直接判失败
async fn post_form(url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    let text = http()
        .post(url)
        .form(form)
        .send()
        .await
        .map_err(|e| format!("请求 {url} 失败: {e}"))?
        .text()
        .await
        .map_err(|e| format!("读取 {url} 响应失败: {e}"))?;
    Ok(serde_json::from_str(&text).unwrap_or_else(
        |_| json!({ "error": "invalid_response", "error_description": clip(&text, 200) }),
    ))
}

/// JSON 请求；非 2xx 直接把状态码与 body 片段带回来，方便定位是哪一环挂了
async fn request_json(builder: reqwest::RequestBuilder, what: &str) -> Result<Value, String> {
    let resp = builder
        .send()
        .await
        .map_err(|e| format!("{what} 请求失败: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("{what} 读取响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!("{what} 返回 HTTP {}: {}", status, clip(&text, 200)));
    }
    serde_json::from_str(&text).map_err(|e| format!("{what} 解析失败: {e}"))
}

fn auth_header(builder: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    builder.header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
}

// ── 设备码 ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct DeviceSession {
    device_code: String,
    client_id: String,
    interval: u64,
    expires_at: u64,
}

static PENDING: OnceLock<Mutex<Option<DeviceSession>>> = OnceLock::new();

fn pending() -> &'static Mutex<Option<DeviceSession>> {
    PENDING.get_or_init(|| Mutex::new(None))
}

/// 从 devicecode 响应里抽出给 UI 的字段（纯函数，便于单测）
pub fn parse_device_code(v: &Value) -> Result<(String, String, String, u64, u64), String> {
    if let Some(e) = v.get("error").and_then(|x| x.as_str()) {
        let d = v
            .get("error_description")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        return Err(format!("微软设备码申请失败: {e} {d}").trim().to_string());
    }
    let user_code = v
        .get("user_code")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let device_code = v
        .get("device_code")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let verification_uri = v
        .get("verification_uri")
        .or_else(|| v.get("verification_uri_complete"))
        .and_then(|x| x.as_str())
        .unwrap_or("https://www.microsoft.com/link")
        .to_string();
    let interval = v
        .get("interval")
        .and_then(|x| x.as_u64())
        .unwrap_or(5)
        .max(1);
    let expires_in = v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900);
    if user_code.is_empty() || device_code.is_empty() {
        return Err("微软设备码响应缺少 user_code / device_code".into());
    }
    Ok((
        user_code,
        device_code,
        verification_uri,
        interval,
        expires_in,
    ))
}

/// 开始一次登录：返回 userCode / verificationUri，设备码留在内存里等前端轮询
pub async fn start() -> Result<Value, String> {
    let id = client_id();
    let v = post_form(DEVICE_URL, &[("client_id", id.as_str()), ("scope", SCOPE)]).await?;
    let (user_code, device_code, verification_uri, interval, expires_in) = parse_device_code(&v)?;
    let message = v
        .get("message")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let sess = DeviceSession {
        device_code,
        client_id: id,
        interval,
        expires_at: now_ms().saturating_add(expires_in.saturating_mul(1000)),
    };
    if let Ok(mut g) = pending().lock() {
        *g = Some(sess);
    }
    Ok(json!({
        "userCode": user_code,
        "verificationUri": verification_uri,
        "expiresIn": expires_in,
        "interval": interval,
        "message": message.unwrap_or_else(|| "请在微软页面输入此代码完成授权".to_string()),
    }))
}

/// token 轮询的错误分类（RFC 8628）
pub fn classify_token_error(v: &Value) -> Option<&'static str> {
    match v.get("error").and_then(|x| x.as_str()).unwrap_or("") {
        "authorization_pending" => Some("pending"),
        "slow_down" => Some("slow_down"),
        "expired_token" | "expired_device_code" => Some("expired"),
        "" => None,
        _ => Some("fatal"),
    }
}

/// 单次轮询：pending / expired / done 三种结果，前端按 interval 定时再调
pub async fn poll() -> Result<Value, String> {
    let sess = {
        let g = pending().lock().map_err(|_| "登录状态锁异常".to_string())?;
        g.clone()
            .ok_or_else(|| "没有进行中的正版登录，请先开始登录".to_string())?
    };
    if now_ms() > sess.expires_at {
        if let Ok(mut g) = pending().lock() {
            *g = None;
        }
        return Ok(json!({ "status": "expired", "message": "设备码已过期，请重新开始登录" }));
    }
    let v = post_form(
        TOKEN_URL,
        &[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("code", sess.device_code.as_str()),
            ("client_id", sess.client_id.as_str()),
        ],
    )
    .await?;
    match classify_token_error(&v) {
        Some("pending") => Ok(json!({
            "status": "pending", "interval": sess.interval,
            "message": "等待用户在微软页面完成授权…"
        })),
        Some("slow_down") => Ok(json!({
            "status": "pending", "interval": sess.interval.saturating_add(5),
            "message": "请求过快，已放慢轮询…"
        })),
        Some("expired") => {
            if let Ok(mut g) = pending().lock() {
                *g = None;
            }
            Ok(json!({ "status": "expired", "message": "设备码已过期，请重新开始登录" }))
        }
        Some("fatal") => {
            if let Ok(mut g) = pending().lock() {
                *g = None;
            }
            let e = v.get("error").and_then(|x| x.as_str()).unwrap_or("unknown");
            let d = v
                .get("error_description")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            Err(format!("微软授权失败: {e} {}", clip(d, 200))
                .trim()
                .to_string())
        }
        _ => {
            let access = v.get("access_token").and_then(|x| x.as_str()).unwrap_or("");
            if access.is_empty() {
                return Err("微软授权响应缺少 access_token".into());
            }
            let refresh = v
                .get("refresh_token")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            let acc = complete(access, refresh).await?;
            settings::upsert_account(&acc)?;
            if let Ok(mut g) = pending().lock() {
                *g = None;
            }
            Ok(json!({ "status": "done", "account": acc }))
        }
    }
}

// ── XBL → XSTS → Minecraft ─────────────────────────────────────

fn json_str<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = v;
    for k in path {
        cur = cur.get(*k)?;
    }
    cur.as_str()
}

/// Xbox Live 的 RpsTicket 格式：d=<MSA access_token>
pub fn rps_ticket(access: &str) -> String {
    format!("d={access}")
}

/// XSTS identityToken 格式：XBL3.0 x=<uhs>;<xstsToken>
pub fn identity_token(uhs: &str, xsts: &str) -> String {
    format!("XBL3.0 x={uhs};{xsts}")
}

/// 把 Mojang 的无横线 UUID 补成带横线形式
pub fn dashed_uuid(id: &str) -> String {
    let h: String = id.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if h.len() != 32 {
        return id.to_string();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

/// 微软账号完成链路。entitlements 只作标记：没有授权也允许落账号，
/// 但 UI 会显示「未检测到正版授权」并劝导购买（与 PCL 的购买劝导一致）。
async fn complete(msa_access: &str, refresh: Option<String>) -> Result<Account, String> {
    let xbl = request_json(
        http().post(XBL_URL).json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": rps_ticket(msa_access),
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT",
        })),
        "Xbox Live 认证",
    )
    .await?;
    let xbl_token = json_str(&xbl, &["Token"]).ok_or("Xbox Live 响应缺少 Token")?;
    let xbl_uhs = xbl
        .get("DisplayClaims")
        .and_then(|d| d.get("xui"))
        .and_then(|x| x.get(0))
        .and_then(|x| x.get("uhs"))
        .and_then(|x| x.as_str())
        .unwrap_or("");

    let xsts = request_json(
        http().post(XSTS_URL).json(&json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token],
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT",
        })),
        "XSTS 授权",
    )
    .await?;
    let xsts_token = json_str(&xsts, &["Token"]).ok_or("XSTS 响应缺少 Token")?;
    let uhs = xsts
        .get("DisplayClaims")
        .and_then(|d| d.get("xui"))
        .and_then(|x| x.get(0))
        .and_then(|x| x.get("uhs"))
        .and_then(|x| x.as_str())
        .unwrap_or(xbl_uhs);
    let xuid = xsts
        .get("DisplayClaims")
        .and_then(|d| d.get("xui"))
        .and_then(|x| x.get(0))
        .and_then(|x| x.get("xid"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    let mc = request_json(
        http()
            .post(MC_LOGIN_URL)
            .json(&json!({ "identityToken": identity_token(uhs, xsts_token) })),
        "Minecraft 登录",
    )
    .await?;
    let mc_token = json_str(&mc, &["access_token"]).ok_or("Minecraft 登录响应缺少 access_token")?;
    let expires_in = mc
        .get("expires_in")
        .and_then(|x| x.as_u64())
        .unwrap_or(86400);
    let bearer = mc_token.to_string();

    let entitled = match request_json(
        auth_header(http().get(ENTITLEMENTS_URL), &bearer),
        "正版授权校验",
    )
    .await
    {
        Ok(v) => Some(
            v.get("items")
                .and_then(|x| x.as_array())
                .is_some_and(|a| !a.is_empty()),
        ),
        Err(_) => Some(false),
    };

    let profile = request_json(
        auth_header(http().get(PROFILE_URL), &bearer),
        "Minecraft 角色查询",
    )
    .await
    .map_err(|e| {
        if e.contains("HTTP 404") {
            "该微软账号没有 Minecraft Java 版角色，请确认已购买并创建角色".to_string()
        } else {
            e
        }
    })?;
    let name = json_str(&profile, &["name"])
        .ok_or("角色资料缺少 name")?
        .to_string();
    let uuid = dashed_uuid(json_str(&profile, &["id"]).unwrap_or(""));
    let (skin_url, cape_url, skin_model) = parse_profile_skins(&profile);

    Ok(Account {
        name,
        uuid,
        kind: "microsoft".into(),
        refresh_token: refresh.filter(|s| !s.is_empty()),
        access_token: Some(bearer),
        expires_at: Some(now_ms().saturating_add(expires_in.saturating_mul(1000))),
        xuid,
        skin_url,
        cape_url,
        skin_model: Some(skin_model),
        entitled,
    })
}

/// minecraft/profile 的 skins/capes：取 state=ACTIVE 的那一项（纯函数）
pub fn parse_profile_skins(p: &Value) -> (Option<String>, Option<String>, String) {
    let pick = |key: &str| -> Option<&Value> {
        p.get(key).and_then(|x| x.as_array()).and_then(|a| {
            a.iter()
                .find(|x| x.get("state").and_then(|s| s.as_str()) == Some("ACTIVE"))
                .or_else(|| a.first())
        })
    };
    let skin_url = pick("skins")
        .and_then(|x| x.get("url"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let cape_url = pick("capes")
        .and_then(|x| x.get("url"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let variation = pick("skins")
        .and_then(|x| x.get("variation"))
        .and_then(|x| x.as_str())
        .unwrap_or("CLASSIC");
    let model = if variation.eq_ignore_ascii_case("SLIM") {
        "slim"
    } else {
        "classic"
    };
    (skin_url, cape_url, model.to_string())
}

/// 用 refresh token 续期；成功后覆盖 accounts.json
pub async fn refresh(name: &str) -> Result<Account, String> {
    let a = settings::find_account(name).ok_or_else(|| format!("账号 {name} 不存在"))?;
    if !a.is_microsoft() {
        return Err(format!("账号 {name} 是离线账号，无需刷新"));
    }
    let rt = a
        .refresh_token
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("账号 {name} 没有刷新令牌，请重新进行微软正版登录"))?;
    let id = client_id();
    let v = post_form(
        TOKEN_URL,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", rt.as_str()),
            ("client_id", id.as_str()),
        ],
    )
    .await?;
    if classify_token_error(&v).is_some() {
        let d = v
            .get("error_description")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        return Err(format!(
            "刷新登录失败，请重新进行微软正版登录: {}",
            clip(d, 160)
        ));
    }
    let access = v.get("access_token").and_then(|x| x.as_str()).unwrap_or("");
    if access.is_empty() {
        return Err("刷新登录响应缺少 access_token".into());
    }
    let new_rt = v
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or(rt);
    let mut acc = complete(access, Some(new_rt)).await?;
    // 角色名理论上不变；若微软侧改名，仍按旧名字定位账号，避免 UI 里出现两个条目
    acc.name = a.name.clone();
    settings::upsert_account(&acc)?;
    Ok(acc)
}

/// 启动前调用：过期就自动续期，返回可用于启动的账号
pub async fn ensure_fresh(a: &Account) -> Result<Account, String> {
    if !a.needs_refresh() {
        return Ok(a.clone());
    }
    match refresh(&a.name).await {
        Ok(fresh) => Ok(fresh),
        Err(e) => Err(format!(
            "{}（正版登录已过期，请在设置页重新登录）: {e}",
            a.name
        )),
    }
}

// ── 皮肤 ───────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SkinInfo {
    pub name: String,
    pub uuid: String,
    pub skin_url: Option<String>,
    pub cape_url: Option<String>,
    pub skin_model: String,
    pub source: String,
    pub fallback: bool,
}

impl SkinInfo {
    pub fn to_value(&self) -> Value {
        json!({
            "name": self.name,
            "uuid": self.uuid,
            "skinUrl": self.skin_url,
            "capeUrl": self.cape_url,
            "skinModel": self.skin_model,
            "source": self.source,
            "fallback": self.fallback,
        })
    }
}

/// 没有皮肤时按 UUID 稳定地选 Steve(经典) / Alex(纤细)
pub fn default_model(uuid: &str) -> String {
    let last = uuid
        .chars()
        .rev()
        .find(|c| c.is_ascii_hexdigit())
        .unwrap_or('0');
    if last.to_digit(16).unwrap_or(0) % 2 == 0 {
        "slim".into()
    } else {
        "classic".into()
    }
}

/// 内置默认皮肤（64×64 RGBA PNG），供 /api/skin/image 回退
pub fn fallback_png(model: Option<&str>) -> &'static [u8] {
    if model == Some("slim") {
        include_bytes!("../../web/public/alex.png")
    } else {
        include_bytes!("../../web/public/steve.png")
    }
}

/// sessionserver 的 textures 是标准 base64 JSON；这里只解析需要的三个字段
pub fn parse_textures(t: &Value) -> (Option<String>, Option<String>, String) {
    let tex = t.get("textures").unwrap_or(t);
    let skin_url = tex
        .get("SKIN")
        .and_then(|x| x.get("url"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let cape_url = tex
        .get("CAPE")
        .and_then(|x| x.get("url"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let model = tex
        .get("SKIN")
        .and_then(|x| x.get("metadata"))
        .and_then(|x| x.get("model"))
        .and_then(|x| x.as_str())
        .unwrap_or("classic");
    let model = if model.eq_ignore_ascii_case("slim") {
        "slim"
    } else {
        "classic"
    };
    (skin_url, cape_url, model.to_string())
}

/// 离线账号：按名字查 Mojang → sessionserver → textures（旧纹理常已下线，允许失败）
async fn mojang_textures(name: &str) -> Option<(String, Option<String>, Option<String>, String)> {
    let nm = urlencode(name);
    let v = request_json(
        http().get(format!("{MOJANG_NAME_URL}/{nm}")),
        "Mojang 用户名查询",
    )
    .await
    .ok()?;
    let id = v.get("id").and_then(|x| x.as_str())?;
    let p = request_json(http().get(format!("{SESSION_URL}/{id}")), "皮肤资料查询")
        .await
        .ok()?;
    let props = p.get("properties").and_then(|x| x.as_array())?;
    let val = props
        .iter()
        .find(|x| x.get("name").and_then(|n| n.as_str()) == Some("textures"))
        .or_else(|| props.first())
        .and_then(|x| x.get("value"))
        .and_then(|x| x.as_str())?;
    let raw = base64::engine::general_purpose::STANDARD.decode(val).ok()?;
    let t: Value = serde_json::from_slice(&raw).ok()?;
    let (skin, cape, model) = parse_textures(&t);
    Some((dashed_uuid(id), skin, cape, model))
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 查一个账号的皮肤：正版用登录缓存，离线按名字查 Mojang，都失败就回退内置默认皮肤
pub async fn skin_for(name: &str) -> Result<Value, String> {
    let a = settings::find_account(name).unwrap_or_else(|| Account::offline(name));
    if a.is_microsoft() && a.skin_url.is_some() {
        return Ok(SkinInfo {
            name: a.name.clone(),
            uuid: a.uuid.clone(),
            skin_url: a.skin_url.clone(),
            cape_url: a.cape_url.clone(),
            skin_model: a.skin_model.clone().unwrap_or_else(|| "classic".into()),
            source: "microsoft".into(),
            fallback: false,
        }
        .to_value());
    }
    if let Some((uuid, skin, cape, model)) = mojang_textures(&a.name).await {
        return Ok(SkinInfo {
            name: a.name.clone(),
            uuid,
            skin_url: skin,
            cape_url: cape,
            skin_model: model,
            source: "mojang".into(),
            fallback: false,
        }
        .to_value());
    }
    let model = default_model(&a.uuid);
    Ok(SkinInfo {
        name: a.name.clone(),
        uuid: a.uuid.clone(),
        skin_url: None,
        cape_url: None,
        skin_model: model,
        source: "default".into(),
        fallback: true,
    }
    .to_value())
}

/// 皮肤 URL 白名单：只允许 Mojang / Microsoft 的官方域名，防 SSRF
fn allowed_skin_url(u: &str) -> bool {
    let Ok(p) = reqwest::Url::parse(u) else {
        return false;
    };
    if !matches!(p.scheme(), "http" | "https") {
        return false;
    }
    let h = p.host_str().unwrap_or("");
    h == "textures.minecraft.net"
        || h.ends_with(".minecraft.net")
        || h == "api.minecraftservices.com"
        || h.ends_with(".mojang.com")
}

/// 同源图片代理。拉取失败（实测 Notch 的旧纹理 404）就回退内置 Steve/Alex，
/// 因此前端 <img> 永远拿得到一张 PNG，不会裂图。
pub async fn skin_image(url: Option<String>, model: Option<String>) -> Vec<u8> {
    let m = model.as_deref().unwrap_or("classic");
    if let Some(u) = url.filter(|s| !s.is_empty()) {
        if allowed_skin_url(&u) {
            if let Ok(resp) = http().get(&u).send().await {
                if resp.status().is_success() {
                    let ct = resp
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("");
                    if ct.starts_with("image/") {
                        if let Ok(bytes) = resp.bytes().await {
                            if bytes.len() > 32 && bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
                                return bytes.to_vec();
                            }
                        }
                    }
                }
            }
        }
    }
    fallback_png(Some(m)).to_vec()
}

// ── 单测：全部离线，只验证协议拼装与解析 ───────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_code_fields() {
        let v = json!({
            "user_code": "5LR8KQ4N", "device_code": "abc", "verification_uri": "https://microsoft.com/link",
            "expires_in": 900, "interval": 5, "message": "Enter code"
        });
        let (u, d, uri, i, e) = parse_device_code(&v).unwrap();
        assert_eq!(u, "5LR8KQ4N");
        assert_eq!(d, "abc");
        assert_eq!(uri, "https://microsoft.com/link");
        assert_eq!(i, 5);
        assert_eq!(e, 900);
        let err = json!({"error":"unauthorized_client","error_description":"AADSTS700016"});
        assert!(parse_device_code(&err)
            .unwrap_err()
            .contains("AADSTS700016"));
    }

    #[test]
    fn oauth_error_classification() {
        assert_eq!(
            classify_token_error(&json!({"error":"authorization_pending"})),
            Some("pending")
        );
        assert_eq!(
            classify_token_error(&json!({"error":"slow_down"})),
            Some("slow_down")
        );
        assert_eq!(
            classify_token_error(&json!({"error":"expired_token"})),
            Some("expired")
        );
        assert_eq!(
            classify_token_error(&json!({"error":"invalid_grant"})),
            Some("fatal")
        );
        assert_eq!(classify_token_error(&json!({"access_token":"x"})), None);
    }

    #[test]
    fn protocol_strings() {
        assert_eq!(rps_ticket("MSA"), "d=MSA");
        assert_eq!(identity_token("uhs1", "XSTS"), "XBL3.0 x=uhs1;XSTS");
        assert_eq!(
            dashed_uuid("069a79f444e94726a5befca90e38aaf5"),
            "069a79f4-44e9-4726-a5be-fca90e38aaf5"
        );
        assert_eq!(dashed_uuid("not-a-uuid"), "not-a-uuid");
    }

    #[test]
    fn profile_skin_variation() {
        let p = json!({"skins":[
            {"state":"INACTIVE","url":"https://old","variation":"CLASSIC"},
            {"state":"ACTIVE","url":"https://textures.minecraft.net/texture/abc","variation":"SLIM"}
        ],"capes":[{"state":"ACTIVE","url":"https://cape"}]});
        let (s, c, m) = parse_profile_skins(&p);
        assert_eq!(
            s.as_deref(),
            Some("https://textures.minecraft.net/texture/abc")
        );
        assert_eq!(c.as_deref(), Some("https://cape"));
        assert_eq!(m, "slim");
    }

    #[test]
    fn textures_base64_roundtrip() {
        let payload = json!({"textures":{"SKIN":{"url":"https://textures.minecraft.net/texture/abc","metadata":{"model":"slim"}},"CAPE":{"url":"https://cape"}}});
        let enc = base64::engine::general_purpose::STANDARD.encode(payload.to_string().as_bytes());
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&enc)
            .unwrap();
        let t: Value = serde_json::from_slice(&raw).unwrap();
        let (s, c, m) = parse_textures(&t);
        assert_eq!(
            s.as_deref(),
            Some("https://textures.minecraft.net/texture/abc")
        );
        assert_eq!(c.as_deref(), Some("https://cape"));
        assert_eq!(m, "slim");
    }

    #[test]
    fn fallback_is_real_png() {
        for model in [Some("classic"), Some("slim"), None] {
            let b = fallback_png(model);
            assert!(b.starts_with(&[0x89, b'P', b'N', b'G']), "PNG 签名");
            assert!(b.len() > 1000);
        }
        assert_ne!(fallback_png(Some("classic")), fallback_png(Some("slim")));
    }

    #[test]
    fn skin_url_allowlist_blocks_ssrf() {
        assert!(allowed_skin_url(
            "https://textures.minecraft.net/texture/abc"
        ));
        assert!(allowed_skin_url("http://assets.mojang.com/x.png"));
        assert!(!allowed_skin_url("http://127.0.0.1:8790/api/state"));
        assert!(!allowed_skin_url("file:///etc/passwd"));
        assert!(!allowed_skin_url("https://evil.com/texture/abc"));
    }

    #[test]
    fn account_serialization_never_leaks_tokens() {
        let a = Account {
            name: "Notch".into(),
            uuid: "u".into(),
            kind: "microsoft".into(),
            refresh_token: Some("SECRET-REFRESH".into()),
            access_token: Some("SECRET-ACCESS".into()),
            ..Default::default()
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v["kind"], "microsoft");
        assert_eq!(v["hasSession"], true);
        let txt = serde_json::to_string(&v).unwrap();
        assert!(!txt.contains("SECRET-REFRESH") && !txt.contains("SECRET-ACCESS"));
        assert!(a.needs_refresh());
        assert!(!Account::offline("Steve").has_session());
    }
}
