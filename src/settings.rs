//! 持久化配置与账号（~/.local/share/lycomc/settings.json、accounts.json）

use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use crate::mc::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 分配给游戏堆的内存（MB）
    pub memory_mb: u32,
    /// 手动指定的 java 可执行文件；None = 自动探测/自动下载
    pub java_path: Option<String>,
    /// 追加的 JVM 参数
    pub extra_jvm_args: Vec<String>,
    /// 主页默认选中的实例
    pub select_version: Option<String>,
    /// 下载源：mojang = 官方，bmcl = 国内镜像（BMCLAPI + MCIM + 清华 TUNA）
    pub download_source: String,
    /// 同时下载文件数
    pub max_concurrent: usize,
    /// 启动游戏后是否关掉启动器
    pub close_on_launch: bool,
    /// 游戏内语言（每次启动写入 options.txt 的 lang）
    pub game_lang: String,
    /// 默认账号：启动时未显式指定账号就用它；None = 账号列表第一项
    pub default_account: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            memory_mb: 4096,
            java_path: None,
            extra_jvm_args: Vec::new(),
            select_version: None,
            download_source: "bmcl".into(),
            max_concurrent: 16,
            close_on_launch: false,
            game_lang: "zh_cn".into(),
            default_account: None,
        }
    }
}

impl Settings {
    /// 把明显不合理的字段拉回可用范围（用户手改 json 也不至于崩）
    pub fn sanitize(&mut self) {
        if self.memory_mb < 256 {
            self.memory_mb = 512;
        }
        if self.memory_mb > 65536 {
            self.memory_mb = 65536;
        }
        if self.max_concurrent == 0 {
            self.max_concurrent = 1;
        }
        if self.max_concurrent > 64 {
            self.max_concurrent = 64;
        }
        if !matches!(self.download_source.as_str(), "mojang" | "bmcl") {
            self.download_source = "mojang".into();
        }
        if self
            .java_path
            .as_deref()
            .is_some_and(|v| v.trim().is_empty())
        {
            self.java_path = None;
        }
        if self
            .select_version
            .as_deref()
            .is_some_and(|v| v.trim().is_empty())
        {
            self.select_version = None;
        }
        self.extra_jvm_args.retain(|a| !a.trim().is_empty());
        if self
            .default_account
            .as_deref()
            .is_some_and(|v| v.trim().is_empty())
        {
            self.default_account = None;
        }
        let g = self.game_lang.trim().to_lowercase();
        if g.is_empty() || !g.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
            self.game_lang = "zh_cn".into();
        } else {
            self.game_lang = g;
        }
    }

    pub fn source(&self) -> crate::mc::meta::Source {
        match self.download_source.as_str() {
            "bmcl" => crate::mc::meta::Source::Bmcl,
            _ => crate::mc::meta::Source::Mojang,
        }
    }
}

/// 读配置；文件缺失或损坏都退回默认值
pub fn load() -> Settings {
    let mut s = std::fs::read_to_string(paths::settings_file())
        .ok()
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok())
        .unwrap_or_default();
    s.sanitize();
    s
}

pub fn save(s: &Settings) -> Result<Settings, String> {
    let mut s = s.clone();
    s.sanitize();
    let p = paths::settings_file();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let body = serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("写配置失败: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("提交配置失败: {e}"))?;
    Ok(s)
}

// ── 账号 ───────────────────────────────────────────────────────

/// 账号。离线（kind="offline"）与微软正版（kind="microsoft"）共用一张表。
///
/// 序列化时**只输出公开字段**：refreshToken / accessToken 属于凭据，
/// 绝不能通过 /api/state、/api/accounts 或 CLI 输出泄露。落盘单独走
/// save_accounts 的显式字段表，保证两者互不干扰。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub name: String,
    pub uuid: String,
    pub kind: String,
    #[serde(default, alias = "refresh_token")]
    pub refresh_token: Option<String>,
    #[serde(default, alias = "access_token")]
    pub access_token: Option<String>,
    #[serde(default, alias = "expires_at")]
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub xuid: Option<String>,
    #[serde(default, alias = "skin_url")]
    pub skin_url: Option<String>,
    #[serde(default, alias = "cape_url")]
    pub cape_url: Option<String>,
    #[serde(default, alias = "skin_model")]
    pub skin_model: Option<String>,
    #[serde(default)]
    pub entitled: Option<bool>,
}

impl Serialize for Account {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = ser.serialize_struct("Account", 9)?;
        st.serialize_field("name", &self.name)?;
        st.serialize_field("uuid", &self.uuid)?;
        st.serialize_field("kind", &self.kind)?;
        st.serialize_field("hasSession", &self.has_session())?;
        if let Some(v) = &self.entitled {
            st.serialize_field("entitled", v)?;
        }
        if let Some(v) = &self.skin_url {
            st.serialize_field("skinUrl", v)?;
        }
        if let Some(v) = &self.cape_url {
            st.serialize_field("capeUrl", v)?;
        }
        if let Some(v) = &self.skin_model {
            st.serialize_field("skinModel", v)?;
        }
        if let Some(v) = &self.expires_at {
            st.serialize_field("expiresAt", v)?;
        }
        st.end()
    }
}

impl Account {
    pub fn offline(name: &str) -> Self {
        Self {
            name: name.to_string(),
            uuid: crate::mc::offline_uuid(name),
            kind: "offline".into(),
            ..Default::default()
        }
    }
    pub fn is_microsoft(&self) -> bool {
        self.kind == "microsoft"
    }
    /// 是否仍处于登录态（有 refresh token 即可自动续期）
    pub fn has_session(&self) -> bool {
        self.is_microsoft() && (self.access_token.is_some() || self.refresh_token.is_some())
    }
    /// 是否需要在启动前刷新 access token
    pub fn needs_refresh(&self) -> bool {
        if !self.is_microsoft() {
            return false;
        }
        let token_ok = self.access_token.as_deref().is_some_and(|t| !t.is_empty());
        let fresh = self
            .expires_at
            .is_some_and(|e| e > crate::jobs::now_ms().saturating_add(60_000));
        !token_ok || !fresh
    }
}

/// 离线账号名限制：Minecraft 用户名 3–16 位字母数字下划线
pub fn valid_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.len() < 3 || n.len() > 16 {
        return Err("用户名需 3–16 个字符".into());
    }
    if !n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("用户名只能包含字母、数字和下划线".into());
    }
    Ok(())
}

pub fn load_accounts() -> Vec<Account> {
    std::fs::read_to_string(paths::accounts_file())
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<Account>>(&t).ok())
        .map(|mut v| {
            // 老文件里没有 uuid / kind；顺手把不认识的 kind 收敛成离线
            for a in v.iter_mut() {
                if a.uuid.trim().is_empty() {
                    a.uuid = crate::mc::offline_uuid(&a.name);
                }
                if a.kind.trim().is_empty() || !matches!(a.kind.as_str(), "offline" | "microsoft") {
                    a.kind = "offline".into();
                }
            }
            v
        })
        .unwrap_or_default()
}

/// 落盘时显式写出凭据字段（Account 的 Serialize 故意不输出它们）。
fn disk_value(a: &Account) -> serde_json::Value {
    let mut v = serde_json::json!({ "name": &a.name, "uuid": &a.uuid, "kind": &a.kind });
    if let Some(x) = &a.refresh_token {
        v["refreshToken"] = serde_json::json!(x);
    }
    if let Some(x) = &a.access_token {
        v["accessToken"] = serde_json::json!(x);
    }
    if let Some(x) = &a.expires_at {
        v["expiresAt"] = serde_json::json!(x);
    }
    if let Some(x) = &a.xuid {
        v["xuid"] = serde_json::json!(x);
    }
    if let Some(x) = &a.skin_url {
        v["skinUrl"] = serde_json::json!(x);
    }
    if let Some(x) = &a.cape_url {
        v["capeUrl"] = serde_json::json!(x);
    }
    if let Some(x) = &a.skin_model {
        v["skinModel"] = serde_json::json!(x);
    }
    if let Some(x) = &a.entitled {
        v["entitled"] = serde_json::json!(x);
    }
    v
}

pub fn save_accounts(list: &[Account]) -> Result<(), String> {
    let p = paths::accounts_file();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let disk: Vec<serde_json::Value> = list.iter().map(disk_value).collect();
    let body = serde_json::to_vec_pretty(&disk).map_err(|e| e.to_string())?;
    // accounts.json 含微软 refresh/access token：只允许本人读写（0600），
    // 并且先写临时文件再原子 rename，避免中途崩溃留下半截 JSON。
    let tmp = p.with_extension("json.tmp");
    // 若旧版曾留下 0644 的临时文件，先删掉，确保本次是全新 0600 inode
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    {
        use std::io::Write;
        let mut f = opts.open(&tmp).map_err(|e| format!("写账号失败: {e}"))?;
        f.write_all(&body).map_err(|e| format!("写账号失败: {e}"))?;
        f.sync_all().map_err(|e| format!("写账号失败: {e}"))?;
    }
    std::fs::rename(&tmp, &p).map_err(|e| format!("提交账号失败: {e}"))?;
    Ok(())
}

/// 按名字覆盖（大小写不敏感）或追加；正版登录/刷新都走这里
pub fn upsert_account(acc: &Account) -> Result<(), String> {
    let mut list = load_accounts();
    match list
        .iter()
        .position(|a| a.name.eq_ignore_ascii_case(&acc.name))
    {
        Some(i) => list[i] = acc.clone(),
        None => list.push(acc.clone()),
    }
    save_accounts(&list)
}

pub fn add_account(name: &str) -> Result<Account, String> {
    valid_name(name)?;
    let n = name.trim().to_string();
    let mut list = load_accounts();
    if list.iter().any(|a| a.name.eq_ignore_ascii_case(&n)) {
        return Err(format!("账号 {n} 已存在"));
    }
    let acc = Account::offline(&n);
    list.push(acc.clone());
    save_accounts(&list)?;
    Ok(acc)
}

pub fn remove_account(name: &str) -> Result<(), String> {
    let mut list = load_accounts();
    let before = list.len();
    list.retain(|a| a.name != name);
    if list.len() == before {
        return Err(format!("账号 {name} 不存在"));
    }
    save_accounts(&list)?;
    // 删掉的正好是默认账号：顺手清掉悬空引用，避免启动时回退到别的账号后
    // settings.json 里还留着一个不存在的名字。
    let mut s = load();
    if s.default_account.as_deref() == Some(name) {
        s.default_account = None;
        save(&s)?;
    }
    Ok(())
}

/// 启动时缺省用哪个账号：优先 settings.defaultAccount（且该账号仍存在），
/// 否则回退账号列表第一项。只返回名字，调用方再 find_account。
pub fn resolve_account_name(s: &Settings) -> Option<String> {
    let list = load_accounts();
    if let Some(name) = s.default_account.as_deref() {
        if let Some(a) = list.iter().find(|a| a.name == name) {
            return Some(a.name.clone());
        }
    }
    list.first().map(|a| a.name.clone())
}

/// 设为默认账号（账号必须已存在），写回 settings.json。
pub fn set_default_account(name: &str) -> Result<Settings, String> {
    let list = load_accounts();
    if !list.iter().any(|a| a.name == name) {
        return Err(format!("账号 {name} 不存在"));
    }
    let mut s = load();
    s.default_account = Some(name.to_string());
    save(&s)
}

/// 退出登录：清凭据但保留账号与皮肤缓存，UI 显示「需重新登录」
pub fn clear_session(name: &str) -> Result<(), String> {
    let mut list = load_accounts();
    let a = list
        .iter_mut()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("账号 {name} 不存在"))?;
    if !a.is_microsoft() {
        return Err(format!("账号 {name} 是离线账号，无需退出登录"));
    }
    a.refresh_token = None;
    a.access_token = None;
    a.expires_at = None;
    a.xuid = None;
    a.entitled = None;
    save_accounts(&list)
}

pub fn find_account(name: &str) -> Option<Account> {
    load_accounts().into_iter().find(|a| a.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_clears_blank_default_account() {
        let mut s = Settings {
            default_account: Some("   ".into()),
            ..Default::default()
        };
        s.sanitize();
        assert_eq!(s.default_account, None);
        let mut s = Settings {
            default_account: Some("Steve".into()),
            ..Default::default()
        };
        s.sanitize();
        assert_eq!(s.default_account.as_deref(), Some("Steve"));
    }

    #[test]
    fn default_account_roundtrips_through_json() {
        let s = Settings {
            default_account: Some("Alex".into()),
            ..Default::default()
        };
        let text = serde_json::to_string(&s).expect("序列化失败");
        assert!(
            text.contains("\"defaultAccount\":\"Alex\""),
            "落盘字段名应为 camelCase: {text}"
        );
        let back: Settings = serde_json::from_str(&text).expect("反序列化失败");
        assert_eq!(back.default_account.as_deref(), Some("Alex"));
    }

    /// 默认账号在隔离数据目录里走完「设置 → 持久化 → 删除账号清悬空引用」。
    /// 用唯一目录避免并行测试互相踩数据。
    #[test]
    fn default_account_survives_disk_and_clears_after_remove() {
        let dir =
            std::env::temp_dir().join(format!("lycomc-default-account-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建隔离目录失败");
        std::env::set_var("LYCOMC_DATA_DIR", &dir);
        save_accounts(&[Account::offline("Steve"), Account::offline("Alex")]).expect("写账号失败");

        let saved = set_default_account("Alex").expect("设为默认失败");
        assert_eq!(saved.default_account.as_deref(), Some("Alex"));
        assert_eq!(
            load().default_account.as_deref(),
            Some("Alex"),
            "必须写回磁盘"
        );
        assert_eq!(resolve_account_name(&load()).as_deref(), Some("Alex"));

        remove_account("Alex").expect("删除账号失败");
        assert_eq!(load().default_account, None, "默认账号被删后引用必须清零");
        assert_eq!(
            resolve_account_name(&load()).as_deref(),
            Some("Steve"),
            "应回退第一个账号"
        );
        std::env::remove_var("LYCOMC_DATA_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_settings_json_without_default_account_still_loads() {
        // 向后兼容：旧配置没有 defaultAccount 字段，必须正常解析为 None。
        let back: Settings = serde_json::from_str(r#"{"memoryMb":2048,"downloadSource":"bmcl"}"#)
            .expect("旧配置应能解析");
        assert_eq!(back.default_account, None);
        assert_eq!(back.memory_mb, 2048);
    }
}
