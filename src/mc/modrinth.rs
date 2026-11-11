//! Modrinth 模组源：搜索、按 MC 版本挑兼容文件、下载到实例 mods/。
//!
//! 只用公开 REST（不需要 token）。搜索接口的 facets 用它自己的语法：
//!   facets=[["project_type:mod"],["versions:1.20.1"]]

use std::path::PathBuf;

use super::meta;

const API: &str = "https://api.modrinth.com/v2";

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
    #[serde(default)]
    pub files: Vec<VersionFile>,
}

/// 搜索（q 空时给热门）
pub async fn search(q: &str, game_version: Option<&str>, loader: Option<&str>) -> Result<SearchResp, String> {
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
    let query = if q.trim().is_empty() { "sort=downloads&limit=20".to_string() } else {
        format!("query={}&limit=20&index=relevance", urlencode(q.trim()))
    };
    let url = format!("{API}/search?{}&facets={}", query, urlencode(&format!("[{}]", facets.join(","))));
    let body = fetch(&url).await?;
    serde_json::from_str(&body).map_err(|e| format!("Modrinth 搜索解析失败: {e}"))
}

/// 取一个项目在指定 MC 版本 + 装载器下最新的兼容版本
pub async fn pick_version(project_id: &str, game_version: &str, loader: &str) -> Result<ModVersion, String> {
    let url = format!(
        "{API}/project/{project_id}/version?game_versions={}&loaders={}",
        urlencode(&format!("[\"{}\"]", game_version)),
        urlencode(&format!("[\"{}\"]", loader)),
    );
    let body = fetch(&url).await?;
    let list: Vec<ModVersion> =
        serde_json::from_str(&body).map_err(|e| format!("Modrinth 版本解析失败: {e}"))?;
    list.into_iter()
        .next()
        .ok_or_else(|| format!("该模组没有适配 {game_version} / {loader} 的文件"))
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
    progress(super::pct(20.0, format!("下载 {}({:.1} MB)…", file.filename, file.size as f64 / 1_048_576.0)));
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

/// 列出实例 mods/ 里的文件
pub fn list_mods(instance_id: &str) -> Vec<serde_json::Value> {
    let dir = super::launch::mods_dir(instance_id);
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if name.ends_with(".disabled") || name.starts_with('.') {
            continue;
        }
        if !name.to_lowercase().ends_with(".jar") {
            continue;
        }
        out.push(serde_json::json!({
            "file": name,
            "name": name.trim_end_matches(".jar"),
            "size": m.len(),
        }));
    }
    out.sort_by(|a, b| {
        a["file"].as_str().unwrap_or("").cmp(b["file"].as_str().unwrap_or(""))
    });
    out
}

pub fn remove_mod(instance_id: &str, file: &str) -> Result<(), String> {
    if file.contains("..") || file.contains('/') || file.contains('\\') {
        return Err("非法文件名".into());
    }
    let p = super::launch::mods_dir(instance_id).join(file);
    if !p.is_file() {
        return Err(format!("{file} 不存在"));
    }
    std::fs::remove_file(&p).map_err(|e| format!("删除失败: {e}"))
}

async fn fetch(url: &str) -> Result<String, String> {
    let c = meta::client();
    let r = c
        .get(url)
        .header("User-Agent", "lycomc/0.1 (Minecraft launcher)")
        .send()
        .await
        .map_err(|e| format!("请求 Modrinth 失败: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Modrinth 返回 HTTP {}", r.status()));
    }
    r.text().await.map_err(|e| e.to_string())
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

