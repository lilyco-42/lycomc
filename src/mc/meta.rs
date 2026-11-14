//! Mojang / Fabric 元数据：版本清单、version json、下载地址。
//!
//! 两个下载源：官方（piston-data / libraries.minecraft.net）与 BMCLAPI 镜像
//! （国内加速，路径一一对应可直接替换前缀）。镜像失败自动回落官方。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::paths;

pub const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const MANIFEST_MIRROR: &str =
    "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json";
pub const RESOURCES_URL: &str = "https://resources.download.minecraft.net";
pub const FABRIC_META: &str = "https://meta.fabricmc.net/v2";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Mojang,
    Bmcl,
}

impl Source {
    pub fn label(self) -> &'static str {
        match self {
            Source::Mojang => "官方",
            Source::Bmcl => "BMCLAPI",
        }
    }
    /// 把官方 URL 换成本源 URL；换不了的原样返回
    pub fn rewrite(self, url: &str) -> String {
        match self {
            Source::Mojang => url.to_string(),
            Source::Bmcl => {
                if let Some(rest) = url.strip_prefix("https://piston-meta.mojang.com") {
                    format!("https://bmclapi2.bangbang93.com{rest}")
                } else if let Some(rest) = url.strip_prefix("https://piston-data.mojang.com") {
                    format!("https://bmclapi2.bangbang93.com{rest}")
                } else if let Some(rest) = url.strip_prefix("https://launchermeta.mojang.com") {
                    format!("https://bmclapi2.bangbang93.com{rest}")
                } else if let Some(rest) = url.strip_prefix("https://libraries.minecraft.net") {
                    format!("https://bmclapi2.bangbang93.com/maven{rest}")
                } else if let Some(rest) =
                    url.strip_prefix("https://resources.download.minecraft.net")
                {
                    format!("https://bmclapi2.bangbang93.com/assets{rest}")
                } else if let Some(rest) = url.strip_prefix("https://meta.fabricmc.net/v2") {
                    // BMCLAPI 的 fabric-meta 与官方 v2 接口一一对应（实测 255 项 loader 一致）
                    format!("https://bmclapi2.bangbang93.com/fabric-meta/v2{rest}")
                } else if let Some(rest) = url.strip_prefix("https://maven.fabricmc.net") {
                    // Fabric profile 的库挂在 maven.fabricmc.net；BMCL /maven 前缀实测可用
                    format!("https://bmclapi2.bangbang93.com/maven{rest}")
                } else {
                    url.to_string()
                }
            }
        }
    }
}

// ── 清单 ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub release_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub latest: Latest,
    pub versions: Vec<VersionEntry>,
}

/// 统一 HTTP 客户端。
///
/// 注意：**不能**用 `ClientBuilder::timeout` —— reqwest 的 timeout 覆盖整个响应体，
/// 国内直连 piston-data 下载 41 MB 的 client.jar 要 160 s 以上，60 s 总超时会把流截断，
/// 报出一句毫无信息量的 `error decoding response body`（真实 bug，2026-11-12 用户实测）。
/// 这里改成连接超时 + 读空闲超时：慢但连续传输不判超时，只有真正卡死才断。
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("lycomc/0.1")
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default()
}

fn cache_path(name: &str) -> PathBuf {
    paths::cache_dir().join(name)
}

/// 拉版本清单（带磁盘缓存；refresh=true 强制重拉）
pub async fn manifest(source: Source, refresh: bool) -> Result<Manifest, String> {
    let p = cache_path("version_manifest_v2.json");
    if !refresh {
        if let Ok(t) = std::fs::read_to_string(&p) {
            if let Ok(m) = serde_json::from_str::<Manifest>(&t) {
                return Ok(m);
            }
        }
    }
    let c = client();
    let primary = match source {
        Source::Mojang => MANIFEST_URL,
        Source::Bmcl => MANIFEST_MIRROR,
    };
    let mut body = match c.get(primary).send().await {
        Ok(r) if r.status().is_success() => r.text().await.map_err(|e| e.to_string())?,
        _ => c
            .get(MANIFEST_URL)
            .send()
            .await
            .map_err(|e| format!("拉取版本清单失败: {e}"))?
            .text()
            .await
            .map_err(|e| e.to_string())?,
    };
    body = body.trim_start_matches('\u{feff}').to_string();
    let m: Manifest = serde_json::from_str(&body).map_err(|e| format!("清单解析失败: {e}"))?;
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&p, &body);
    Ok(m)
}

pub async fn manifest_entry(
    id: &str,
    source: Source,
    refresh: bool,
) -> Result<VersionEntry, String> {
    let m = manifest(source, refresh).await?;
    m.versions
        .into_iter()
        .find(|v| v.id == id)
        .ok_or_else(|| format!("版本清单里没有 {id}"))
}

// ── version json ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub inherits_from: Option<String>,
    #[serde(default)]
    pub main_class: Option<String>,
    #[serde(default)]
    pub assets: Option<String>,
    #[serde(default)]
    pub asset_index: Option<AssetIndex>,
    #[serde(default)]
    pub downloads: Option<Downloads>,
    #[serde(default)]
    pub java_version: Option<JavaVersion>,
    #[serde(default)]
    pub libraries: Vec<Library>,
    #[serde(default)]
    pub arguments: Option<Arguments>,
    #[serde(default)]
    pub minecraft_arguments: Option<String>,
    #[serde(default)]
    pub logging: Option<Logging>,
    #[serde(default)]
    pub release_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndex {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
    #[serde(default, alias = "total_size")]
    pub total_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Downloads {
    #[serde(default)]
    pub client: Option<Artifact>,
    #[serde(default)]
    pub server: Option<Artifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    #[serde(default)]
    pub component: Option<String>,
    #[serde(default, alias = "major_version")]
    pub major_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<serde_json::Value>,
    #[serde(default)]
    pub jvm: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Logging {
    #[serde(default)]
    pub client: Option<LoggingClient>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoggingClient {
    #[serde(default)]
    pub argument: Option<String>,
    #[serde(default)]
    pub file: Option<Artifact>,
    #[serde(default)]
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Library {
    pub name: String,
    /// Fabric 元数据把仓库地址与校验值直接挂在库里（没有 downloads 段）
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub downloads: Option<LibDownloads>,
    #[serde(default)]
    pub natives: Option<HashMap<String, String>>,
    #[serde(default)]
    pub rules: Option<Vec<Rule>>,
    #[serde(default)]
    pub extract: Option<Extract>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Extract {
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibDownloads {
    #[serde(default)]
    pub artifact: Option<Artifact>,
    #[serde(default)]
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Artifact {
    /// maven 相对路径；老版本 json 里可能缺失，需要从 name 推导
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Rule {
    pub action: String,
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OsRule {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

/// 当前平台在 MC 元数据里的名字
pub fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

/// 当前平台在 MC 元数据里的架构名
pub fn os_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "arm64",
        "x86" => "x86",
        other => other,
    }
}

pub fn natives_classifier() -> &'static str {
    if cfg!(target_os = "windows") {
        "natives-windows"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "natives-macos-arm64"
        } else {
            "natives-macos"
        }
    } else {
        "natives-linux"
    }
}

/// 规则求值：默认拒绝，遇 allow 命中即允许，遇 deny 命中即拒绝。
/// features 一律当 false（我们不启用 demo / 自定义分辨率等特性）。
pub fn rules_allow(rules: &Option<Vec<Rule>>) -> bool {
    let Some(rules) = rules else { return true };
    let mut allowed = false;
    for r in rules {
        if !rule_matches(r) {
            continue;
        }
        if r.action == "allow" {
            allowed = true;
        } else if r.action == "disallow" {
            return false;
        }
    }
    allowed
}

fn rule_matches(r: &Rule) -> bool {
    if let Some(features) = &r.features {
        // 只处理我们真正会开启的 feature；其它一律视为 false
        // 我们一个可选 feature 都不开启（不加 --demo、不加 quickPlay 之类），
        // 所以带 features 且要求 true 的参数一律不适用。
        // 只要某个 feature 被要求为 true，而本启动器一个可选 feature 都不开，就不适用
        if features.values().any(|want| *want) {
            return false;
        }
    }
    let Some(os) = &r.os else { return true };
    if let Some(name) = &os.name {
        if name != os_name() {
            return false;
        }
    }
    if let Some(arch) = &os.arch {
        // MC 里 x86 表示 32 位；x86_64/arm64 表示 64 位
        let ok = match arch.as_str() {
            "x86" => cfg!(target_arch = "x86"),
            "x86_64" => cfg!(target_arch = "x86_64"),
            "arm64" => cfg!(target_arch = "aarch64"),
            _ => true,
        };
        if !ok {
            return false;
        }
    }
    true
}

/// maven 坐标 → 仓库相对路径：group:artifact:version[:classifier][@ext]
pub fn maven_path(name: &str) -> String {
    let (coords, ext) = match name.split_once('@') {
        Some((c, e)) => (c, e.to_string()),
        None => (name, "jar".to_string()),
    };
    let parts: Vec<&str> = coords.split(':').collect();
    if parts.len() < 3 {
        return format!("{coords}.{ext}");
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).copied();
    let file = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    format!("{group}/{artifact}/{version}/{file}")
}

/// 读实例的 version json（磁盘）
pub fn read_version_json(path: &Path) -> Result<VersionJson, String> {
    let t =
        std::fs::read_to_string(path).map_err(|e| format!("读 {} 失败: {e}", path.display()))?;
    serde_json::from_str(&t).map_err(|e| format!("{} 解析失败: {e}", path.display()))
}

/// 下载并缓存一个 version json 到 cache/versions/<id>.json，返回内容
pub async fn fetch_version_json(
    id: &str,
    source: Source,
    refresh: bool,
) -> Result<VersionJson, String> {
    let p = cache_path(&format!("versions_{id}.json"));
    if !refresh {
        if let Ok(t) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<VersionJson>(&t) {
                return Ok(v);
            }
        }
    }
    let entry = manifest_entry(id, source, false).await?;
    let url = source.rewrite(&entry.url);
    let c = client();
    let text = match c.get(&url).send().await {
        Ok(r) if r.status().is_success() => r.text().await.map_err(|e| e.to_string())?,
        _ => c
            .get(&entry.url)
            .send()
            .await
            .map_err(|e| format!("拉取 {id} 元数据失败: {e}"))?
            .text()
            .await
            .map_err(|e| e.to_string())?,
    };
    let v: VersionJson =
        serde_json::from_str(&text).map_err(|e| format!("{id} 元数据解析失败: {e}"))?;
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&p, &text);
    Ok(v)
}

/// 资源索引（assets/<id>.json 的内容）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AssetIndexJson {
    #[serde(default)]
    pub objects: HashMap<String, AssetObject>,
    #[serde(default)]
    pub map_to_resources: Option<bool>,
    #[serde(default)]
    #[serde(rename = "virtual")]
    pub virtual_dir: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AssetObject {
    pub hash: String,
    #[serde(default)]
    pub size: u64,
}

#[cfg(test)]
mod mirror_tests {
    use super::Source;

    #[test]
    fn bmcl_rewrites_all_official_prefixes() {
        let b = Source::Bmcl;
        assert_eq!(
            b.rewrite("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"),
            "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json"
        );
        assert_eq!(
            b.rewrite("https://libraries.minecraft.net/com/google/guava/guava/21.0/guava-21.0.jar"),
            "https://bmclapi2.bangbang93.com/maven/com/google/guava/guava/21.0/guava-21.0.jar"
        );
        assert_eq!(
            b.rewrite("https://resources.download.minecraft.net/b6/b62ca8ec10d07e6bf5ac8dae0c8c1d2e6a1e3356"),
            "https://bmclapi2.bangbang93.com/assets/b6/b62ca8ec10d07e6bf5ac8dae0c8c1d2e6a1e3356"
        );
        assert_eq!(
            b.rewrite("https://meta.fabricmc.net/v2/versions/loader/1.20.1"),
            "https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/1.20.1"
        );
        assert_eq!(
            b.rewrite("https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar"),
            "https://bmclapi2.bangbang93.com/maven/net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar"
        );
    }

    #[test]
    fn mojang_keeps_urls_and_unknown_urls_are_untouched() {
        let u = "https://api.modrinth.com/v2/search";
        assert_eq!(Source::Mojang.rewrite(u), u);
        assert_eq!(Source::Bmcl.rewrite(u), u);
    }
}
