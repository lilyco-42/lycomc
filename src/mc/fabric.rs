//! Fabric 安装：从 meta.fabricmc.net 取 loader profile，落成一个继承原版的实例。
//!
//! Fabric 的 profile json 已经是「标准启动器格式」：mainClass 是 KnotClient，
//! libraries 是 fabric 自己的（asm / loader / intermediary …），inheritsFrom 指回原版。
//! 所以只要把父版本也装好，再把 profile 存成实例 json 即可 —— 不需要自己拼参数。

use std::path::PathBuf;

use super::install;
use super::meta::{self, Source};
use super::{paths, ProgressFn};

/// 稳定版 loader 列表里取最新的一个
pub async fn latest_loader(game_version: &str) -> Result<String, String> {
    let url = format!("{}/versions/loader/{}", meta::FABRIC_META, game_version);
    let body = super::download::fetch_text(&url, Source::Mojang).await?;
    let arr: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Fabric loader 列表解析失败: {e}"))?;
    let list = arr.as_array().ok_or_else(|| "Fabric loader 列表格式异常".to_string())?;
    // 优先 stable=true 的第一个
    for item in list {
        let stable = item
            .get("loader")
            .and_then(|l| l.get("stable"))
            .and_then(|s| s.as_bool())
            .unwrap_or(false);
        if !stable {
            continue;
        }
        if let Some(v) = item.get("loader").and_then(|l| l.get("version")).and_then(|v| v.as_str()) {
            return Ok(v.to_string());
        }
    }
    list.first()
        .and_then(|i| i.get("loader"))
        .and_then(|l| l.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("{game_version} 没有可用的 Fabric loader"))
}

/// 安装 fabric 实例：先装原版父版本，再落 profile
pub async fn install_fabric(
    game_version: &str,
    loader: Option<&str>,
    source: Source,
    concurrency: usize,
    progress: ProgressFn<'_>,
) -> Result<(String, PathBuf), String> {
    progress(super::pct(1.0, format!("准备 Fabric（{game_version}）…")));
    let loader = match loader {
        Some(l) if !l.trim().is_empty() => l.trim().to_string(),
        _ => latest_loader(game_version).await?,
    };
    // 父版本必须先就位，否则 fabric 的 jar / assets 都缺
    if !install::is_installed(game_version) {
        progress(super::pct(2.0, format!("先安装原版 {game_version}…")));
        install::install_vanilla(game_version, source, concurrency, progress).await?;
    }
    progress(super::pct(80.0, "拉取 Fabric loader profile…"));
    let url = format!("{}/versions/loader/{}/{}/profile/json", meta::FABRIC_META, game_version, loader);
    let body = super::download::fetch_text(&url, Source::Mojang).await?;
    let profile: meta::VersionJson =
        serde_json::from_str(&body).map_err(|e| format!("Fabric profile 解析失败: {e}"))?;
    let id = profile.id.clone();
    if id.is_empty() {
        return Err("Fabric profile 缺少 id".into());
    }
    let dir = paths::version_dir(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建实例目录失败: {e}"))?;

    // fabric 自己的库（asm / loader / intermediary）也走下载器，带 sha1 校验
    let plan = install::plan_libs(&profile, source)?;
    let mut items: Vec<super::download::Item> = Vec::new();
    for (_, it) in plan.classpath.iter() {
        items.push(it.clone());
    }
    for (_, it, _) in plan.natives.iter() {
        items.push(it.clone());
    }
    if !items.is_empty() {
        progress(super::pct(85.0, format!("下载 {} 个 Fabric 库…", items.len())));
        super::download::fetch_all(items, source, concurrency, progress).await?;
    }

    std::fs::write(dir.join(format!("{id}.json")), &body)
        .map_err(|e| format!("写实例 json 失败: {e}"))?;
    progress(super::pct(100.0, format!("{id} 安装完成")));
    Ok((id, dir))
}

/// 从实例 id 反推基础版本：fabric-loader-<loader>-<ver>
pub fn base_version(id: &str) -> Option<String> {
    let rest = id.strip_prefix("fabric-loader-")?;
    let idx = rest.find('-')?;
    Some(rest[idx + 1..].to_string())
}