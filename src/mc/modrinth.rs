//! Modrinth 模组源：搜索、按 MC 版本挑兼容文件、下载到实例 mods/。
//!
//! 只用公开 REST（不需要 token）。搜索接口的 facets 用它自己的语法：
//!   facets=[["project_type:mod"],["versions:1.20.1"]]

use std::path::PathBuf;

use super::meta;

const API: &str = "https://api.modrinth.com/v2";
/// MCIM 中国镜像：官方 API / CDN 不可达时回落（结构一致，下载不计入作者收益）
const MIRROR_API: &str = "https://mod.mcimirror.top/modrinth/v2";
const MIRROR_CDN: &str = "https://mod.mcimirror.top";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct Hit {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub follows: u64,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub versions: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct SearchResp {
    #[serde(default)]
    pub hits: Vec<Hit>,
    #[serde(default, alias = "total_hits")]
    pub total_hits: u64,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct VersionFile {
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub hashes: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ModVersion {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version_number: String,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    /// ISO-8601 发布时间；MCIM 镜像返回顺序可能过期，必须自己按时间挑最新
    #[serde(default)]
    pub date_published: String,
    #[serde(default)]
    pub files: Vec<VersionFile>,
}

/// 搜索（q 空时给热门）
pub async fn search(
    q: &str,
    game_version: Option<&str>,
    loader: Option<&str>,
) -> Result<SearchResp, String> {
    let mut facets: Vec<String> = vec!["[\"project_type:mod\"]".to_string()];
    if let Some(gv) = game_version {
        if !gv.trim().is_empty() {
            facets.push(format!("[\"versions:{}\"]", gv.trim()));
        }
    }
    if let Some(l) = loader {
        if !l.trim().is_empty() {
            facets.push(format!("[\"categories:{}\"]", l.trim()));
        }
    }
    let query = if q.trim().is_empty() {
        "sort=downloads&limit=20".to_string()
    } else {
        format!("query={}&limit=20&index=relevance", urlencode(q.trim()))
    };
    let url = format!(
        "{API}/search?{}&facets={}",
        query,
        urlencode(&format!("[{}]", facets.join(",")))
    );
    let body = fetch(&url).await?;
    serde_json::from_str(&body).map_err(|e| format!("Modrinth 搜索解析失败: {e}"))
}

/// 取一个项目在指定 MC 版本 + 装载器下最新的兼容版本
pub async fn pick_version(
    project_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<ModVersion, String> {
    let url = format!(
        "{API}/project/{project_id}/version?game_versions={}&loaders={}",
        urlencode(&format!("[\"{}\"]", game_version)),
        urlencode(&format!("[\"{}\"]", loader)),
    );
    let body = fetch(&url).await?;
    let list: Vec<ModVersion> =
        serde_json::from_str(&body).map_err(|e| format!("Modrinth 版本解析失败: {e}"))?;
    newest_version(list).ok_or_else(|| format!("该模组没有适配 {game_version} / {loader} 的文件"))
}

/// 从版本列表里挑发布时间最新的一个。
/// 官方 API 恰好按时间倒序返回，但 MCIM 镜像可能把新版本追加到末尾（缓存顺序过期），
/// 所以不能依赖数组顺序；统一按 date_published 降序（稳定排序，同秒保持原顺序）。
fn newest_version(mut list: Vec<ModVersion>) -> Option<ModVersion> {
    list.sort_by(|a, b| b.date_published.cmp(&a.date_published));
    list.into_iter().next()
}

/// 下载并放到实例的 mods/，返回落地文件名
pub async fn install_mod(
    instance_id: &str,
    project_id: &str,
    game_version: &str,
    loader: &str,
    progress: super::ProgressFn<'_>,
) -> Result<PathBuf, String> {
    progress(super::pct(5.0, "查询 Modrinth…"));
    let v = pick_version(project_id, game_version, loader).await?;
    let file = v
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| v.files.first())
        .cloned()
        .ok_or_else(|| "该版本没有可下载文件".to_string())?;
    let dir = super::launch::mods_dir(instance_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 mods 目录失败: {e}"))?;
    let dest = dir.join(&file.filename);
    // Modrinth 用 sha1 做文件校验（与 MC 生态一致）
    let sha1 = file.hashes.get("sha1").cloned();
    progress(super::pct(
        20.0,
        format!(
            "下载 {}({:.1} MB)…",
            file.filename,
            file.size as f64 / 1_048_576.0
        ),
    ));
    let items = vec![super::download::Item {
        url: file.url.clone(),
        dest: dest.clone(),
        sha1,
        size: Some(file.size),
    }];
    super::download::fetch_all(items, meta::Source::Mojang, 2, progress).await?;
    progress(super::pct(100.0, format!("{} 已安装", file.filename)));
    Ok(dest)
}

/// C17：合法 Mod 文件名。禁用态在 PCL 语义里是追加 .disabled，不复制 PCL 源码。
fn strip_disabled(file: &str) -> (&str, bool) {
    let suffix = ".disabled";
    let Some(at) = file.len().checked_sub(suffix.len()) else {
        return (file, false);
    };
    let Some(tail) = file.get(at..) else {
        return (file, false);
    };
    if tail.eq_ignore_ascii_case(suffix) {
        (file.get(..at).unwrap_or(file), true)
    } else {
        (file, false)
    }
}

fn valid_mod_file(file: &str) -> bool {
    if file.is_empty() || file.len() > 255 || file.starts_with('.') || file.contains("..") {
        return false;
    }
    if file.contains('/') || file.contains('\\') || !file.bytes().all(|c| c >= 32 && c != 127) {
        return false;
    }
    let (base, _) = strip_disabled(file);
    base.get(base.len().saturating_sub(4)..)
        .is_some_and(|ext| ext.eq_ignore_ascii_case(".jar"))
}

fn display_name_of(base: &str) -> &str {
    let at = base.len().saturating_sub(4);
    if base
        .get(at..)
        .is_some_and(|ext| ext.eq_ignore_ascii_case(".jar"))
    {
        &base[..at]
    } else {
        base
    }
}

/// 列出实例 mods/ 里的文件（含 .jar.disabled 禁用态）。
pub fn list_mods(instance_id: &str) -> Vec<serde_json::Value> {
    if !super::instances::valid_id(instance_id) {
        return Vec::new();
    }
    let dir = super::launch::mods_dir(instance_id);
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !valid_mod_file(&name) {
            continue;
        }
        let (base, disabled) = strip_disabled(&name);
        out.push(serde_json::json!({
            "file": name,
            "name": display_name_of(base),
            "size": m.len(),
            "enabled": !disabled,
            "baseFile": base,
            "disabledFile": format!("{base}.disabled"),
            "sha1": serde_json::Value::Null,
            "modId": serde_json::Value::Null,
            "version": serde_json::Value::Null,
            "description": serde_json::Value::Null,
            "loader": serde_json::Value::Null,
        }));
    }
    out.sort_by(|a, b| {
        a["file"]
            .as_str()
            .unwrap_or("")
            .cmp(b["file"].as_str().unwrap_or(""))
    });
    out
}

/// C17：读取单个本地 Mod 信息（不联网），禁用态自动映射回启用文件名。
pub fn mod_info(instance_id: &str, file: &str) -> Result<serde_json::Value, String> {
    if !super::instances::valid_id(instance_id) {
        return Err("非法实例 ID".into());
    }
    if !valid_mod_file(file) {
        return Err("非法文件名".into());
    }
    let dir = super::launch::mods_dir(instance_id);
    let path = dir.join(file);
    if !path.is_file() {
        return Err(format!("{file} 不存在"));
    }
    let meta_data = std::fs::metadata(&path).map_err(|e| format!("读取失败: {e}"))?;
    let (base, disabled) = strip_disabled(file);
    let sha1 = super::download::sha1_file(&path).ok();
    let (mod_id, version, description, loader) = read_local_metadata(&path);
    Ok(serde_json::json!({
        "file": file,
        "name": display_name_of(base),
        "size": meta_data.len(),
        "enabled": !disabled,
        "baseFile": base,
        "disabledFile": format!("{base}.disabled"),
        "sha1": sha1,
        "modId": mod_id,
        "version": version,
        "description": description,
        "loader": loader,
    }))
}

fn read_local_metadata(
    path: &std::path::Path,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let Ok(f) = std::fs::File::open(path) else {
        return (None, None, None, None);
    };
    let Ok(mut z) = zip::ZipArchive::new(f) else {
        return (None, None, None, None);
    };
    for member in [
        "fabric.mod.json",
        "quilt.mod.json",
        "META-INF/mods.toml",
        "mcmod.info",
    ] {
        let Ok(mut entry) = z.by_name(member) else {
            continue;
        };
        use std::io::Read;
        let mut bytes = Vec::new();
        if entry.read_to_end(&mut bytes).is_err() || bytes.len() > 2_048 * 1_024 {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        if member.ends_with(".json") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
                let id = s("id")
                    .or_else(|| v.get("schemaVersion").and_then(|_| s("id")))
                    .or_else(|| {
                        v.get("quilt_loader")
                            .and_then(|q| q.get("id"))
                            .and_then(|x| x.as_str())
                            .map(str::to_string)
                    });
                if id.is_some() {
                    return (
                        id,
                        s("version"),
                        s("description"),
                        Some(if member.starts_with("quilt") {
                            "quilt".into()
                        } else {
                            "fabric".into()
                        }),
                    );
                }
            }
        } else if member.ends_with(".toml") {
            let mut id = None;
            let mut version = None;
            let mut description = None;
            for line in text.lines() {
                let l = line.trim();
                if let Some(v) = l
                    .strip_prefix("modId")
                    .and_then(|v| v.trim_start_matches(['=', ' ']).strip_prefix('"'))
                    .and_then(|v| v.split('"').next())
                {
                    id = Some(v.to_string());
                }
                if let Some(v) = l
                    .strip_prefix("version")
                    .and_then(|v| v.trim_start_matches(['=', ' ']).strip_prefix('"'))
                    .and_then(|v| v.split('"').next())
                {
                    version = Some(v.to_string());
                }
                if let Some(v) = l
                    .strip_prefix("description")
                    .and_then(|v| v.trim_start_matches(['=', ' ']).strip_prefix('"'))
                    .and_then(|v| v.split('"').next())
                {
                    description = Some(v.to_string());
                }
            }
            if id.is_some() {
                return (id, version, description, Some("forge".into()));
            }
        } else if text.trim_start().starts_with('[') {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                let first = v.get(0).cloned().unwrap_or(serde_json::Value::Null);
                let s = |k: &str| first.get(k).and_then(|x| x.as_str()).map(str::to_string);
                let id = s("modid");
                if id.is_some() {
                    return (id, s("version"), s("description"), Some("forge".into()));
                }
            }
        }
    }
    (None, None, None, None)
}

/// C17：启用/禁用仅在文件名末尾增删 .disabled，不修改文件内容。
pub fn toggle_mod(
    instance_id: &str,
    file: &str,
    enable: bool,
) -> Result<serde_json::Value, String> {
    if !super::instances::valid_id(instance_id) {
        return Err("非法实例 ID".into());
    }
    if !valid_mod_file(file) {
        return Err("非法文件名".into());
    }
    let dir = super::launch::mods_dir(instance_id);
    let src = dir.join(file);
    if !src.is_file() {
        return Err(format!("{file} 不存在"));
    }
    let (base, disabled) = strip_disabled(file);
    let target_file = if enable {
        if !disabled {
            return Ok(serde_json::json!({ "ok": true, "file": file, "enabled": true }));
        }
        base.to_string()
    } else {
        if disabled {
            return Ok(serde_json::json!({ "ok": true, "file": file, "enabled": false }));
        }
        format!("{base}.disabled")
    };
    if !valid_mod_file(&target_file) || target_file == file {
        return Err("非法目标文件名".into());
    }
    let dst = dir.join(&target_file);
    if dst.exists() {
        return Err(format!("目标文件已存在: {target_file}"));
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("切换失败: {e}"))?;
    Ok(serde_json::json!({ "ok": true, "file": target_file, "enabled": enable }))
}

pub fn remove_mod(instance_id: &str, file: &str) -> Result<(), String> {
    if !super::instances::valid_id(instance_id) {
        return Err("非法实例 ID".into());
    }
    if !valid_mod_file(file) {
        return Err("非法文件名".into());
    }
    let p = super::launch::mods_dir(instance_id).join(file);
    if !p.is_file() {
        return Err(format!("{file} 不存在"));
    }
    std::fs::remove_file(&p).map_err(|e| format!("删除失败: {e}"))
}

/// 官方 API URL -> MCIM 镜像 URL（只换前缀，路径结构一致）
fn mirror_api(url: &str) -> Option<String> {
    url.strip_prefix(API)
        .map(|rest| format!("{MIRROR_API}{rest}"))
}

/// Modrinth CDN URL -> MCIM 镜像；路径必须保留 /data/ 前缀。
pub fn mirror_cdn(url: &str) -> Option<String> {
    if let Some(rest) = url.strip_prefix("https://cdn.modrinth.com") {
        return Some(format!("{MIRROR_CDN}{rest}"));
    }
    if url.starts_with(MIRROR_CDN) {
        return None;
    }
    None
}

async fn fetch(url: &str) -> Result<String, String> {
    let c = meta::client();
    let mut candidates = vec![url.to_string()];
    // BMCL / 国内网络下优先试镜像，失败回落官方
    if let Some(m) = mirror_api(url) {
        candidates.insert(0, m);
    }
    let mut last = String::new();
    for u in &candidates {
        let r = match c.get(u).header("User-Agent", "lycomc/0.1").send().await {
            Ok(r) => r,
            Err(e) => {
                last = format!("请求 Modrinth 失败: {e}");
                continue;
            }
        };
        if !r.status().is_success() {
            last = format!("Modrinth 返回 HTTP {}", r.status());
            continue;
        }
        return r.text().await.map_err(|e| e.to_string());
    }
    Err(last)
}

/// 极简 urlencode（只处理我们真正会发的字符）
pub fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod mirror_tests {
    use super::mirror_cdn;

    #[test]
    fn cdn_rewrite_keeps_data_prefix() {
        assert_eq!(
            mirror_cdn("https://cdn.modrinth.com/data/AANobbMI/versions/ygf8cVZg/sodium.jar"),
            Some("https://mod.mcimirror.top/data/AANobbMI/versions/ygf8cVZg/sodium.jar".into())
        );
    }

    #[test]
    fn newest_version_ignores_stale_mirror_order() {
        use super::{newest_version, ModVersion};
        // 真实观测：MCIM 把 0.5.12/0.5.13 追加在末尾，官方则排在最前。
        let mk = |name: &str, date: &str| ModVersion {
            id: name.into(),
            name: name.into(),
            version_number: name.into(),
            game_versions: vec![],
            loaders: vec![],
            date_published: date.into(),
            files: vec![],
        };
        let stale = vec![
            mk("0.5.11", "2024-06-29T13:43:41.842Z"),
            mk("0.5.10", "2024-06-13T21:09:52.183Z"),
            mk("0.5.12-beta.2", "2025-02-26T00:54:03.278Z"),
            mk("0.5.13", "2025-03-03T17:45:49.132Z"),
        ];
        assert_eq!(newest_version(stale).unwrap().version_number, "0.5.13");
        let official = vec![
            mk("0.5.13", "2025-03-03T17:45:49.132919Z"),
            mk("0.5.11", "2024-06-29T13:43:41.842195Z"),
        ];
        assert_eq!(newest_version(official).unwrap().version_number, "0.5.13");
        assert!(newest_version(vec![]).is_none());
    }

    #[test]
    fn non_modrinth_or_already_mirrored_urls_are_skipped() {
        assert_eq!(mirror_cdn("https://piston-meta.mojang.com/x.json"), None);
        assert_eq!(mirror_cdn("https://mod.mcimirror.top/data/x.jar"), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn with_mods(vid: &str, body: impl FnOnce(&std::path::Path)) {
        let _env_guard = crate::test_env::data_dir_guard();
        let root = std::env::temp_dir().join(format!("lycomc-c17-{}-{}", std::process::id(), vid));
        let dir = root.join("versions").join(vid);
        let mods = dir.join("mods");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(
            dir.join(format!("{vid}.json")),
            "{\"id\":\"x\",\"type\":\"release\",\"javaVersion\":{\"majorVersion\":17}}",
        )
        .unwrap();
        std::env::set_var("LYCOMC_DATA_DIR", &root);
        body(&mods);
        std::env::remove_var("LYCOMC_DATA_DIR");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn toggle_mod_roundtrip_and_collision() {
        with_mods("c17-toggle", |dir| {
            std::fs::write(dir.join("a.jar"), b"jar").unwrap();
            let r = toggle_mod("c17-toggle", "a.jar", false).unwrap();
            assert_eq!(r["file"], "a.jar.disabled");
            assert_eq!(r["enabled"], false);
            assert!(dir.join("a.jar.disabled").is_file());
            let list = list_mods("c17-toggle");
            assert_eq!(list.len(), 1);
            assert_eq!(list[0]["enabled"], false);
            assert_eq!(list[0]["baseFile"], "a.jar");
            assert_eq!(list[0]["disabledFile"], "a.jar.disabled");
            let r = toggle_mod("c17-toggle", "a.jar.disabled", true).unwrap();
            assert_eq!(r["file"], "a.jar");
            assert_eq!(r["enabled"], true);
            std::fs::write(dir.join("b.jar"), b"b").unwrap();
            std::fs::write(dir.join("b.jar.disabled"), b"d").unwrap();
            assert!(toggle_mod("c17-toggle", "b.jar", false).is_err());
        });
    }

    #[test]
    fn path_traversal_and_non_mod_rejected() {
        assert!(!valid_mod_file("../a.jar"));
        assert!(!valid_mod_file("a/b.jar"));
        assert!(!valid_mod_file("a.txt"));
        assert!(valid_mod_file("a.jar.disabled"));
        with_mods("c17-invalid", |dir| {
            std::fs::write(dir.join("c.jar"), b"c").unwrap();
            assert!(toggle_mod("c17-invalid", "../c.jar", false).is_err());
            assert!(mod_info("c17-invalid", "c.jar/../../settings").is_err());
            assert!(remove_mod("c17-invalid", "../c.jar").is_err());
        });
    }

    #[test]
    fn mod_info_reads_local_metadata_and_sha1() {
        use std::io::Write;
        with_mods("c17-info", |dir| {
            let p = dir.join("meta.jar");
            let f = std::fs::File::create(&p).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file("fabric.mod.json", opts).unwrap();
            let payload =
                "{\"id\":\"coolmod\",\"version\":\"1.2.3\",\"description\":\"local mod\"}";
            z.write_all(payload.as_bytes()).unwrap();
            z.finish().unwrap();
            let info = mod_info("c17-info", "meta.jar").unwrap();
            assert_eq!(info["modId"], "coolmod");
            assert_eq!(info["version"], "1.2.3");
            assert_eq!(info["description"], "local mod");
            assert_eq!(info["loader"], "fabric");
            assert_eq!(info["sha1"].as_str().unwrap().len(), 40);
            std::fs::write(dir.join("plain.jar"), b"not zip").unwrap();
            let fallback = mod_info("c17-info", "plain.jar").unwrap();
            assert!(fallback["modId"].is_null());
            assert_eq!(fallback["sha1"].as_str().unwrap().len(), 40);
        });
    }
}
