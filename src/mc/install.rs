//! 安装原版实例：解析继承链 → 下载库/资源/主 jar → 解 natives → 落实例目录。

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::download::{self, Item};
use super::meta::{self, Artifact, Source, VersionJson};
use super::{paths, ProgressFn};

/// 解析继承链（子在前），返回所有 json（含父）
pub async fn resolve_chain(id: &str, source: Source) -> Result<Vec<VersionJson>, String> {
    let mut chain = Vec::new();
    let mut cur = Some(id.to_string());
    let mut guard = 0;
    while let Some(c) = cur {
        guard += 1;
        if guard > 8 {
            return Err("版本继承链过深（疑似元数据损坏）".into());
        }
        let v = meta::fetch_version_json(&c, source, false).await?;
        cur = v.inherits_from.clone();
        chain.push(v);
    }
    Ok(chain)
}

/// 合并继承链：父的库与参数在前，子的覆盖主类/jar/assetIndex
pub fn merge(chain: &[VersionJson], id: &str) -> VersionJson {
    let mut out = VersionJson {
        id: id.to_string(),
        ..Default::default()
    };
    // 从最老的父到最年轻的子依次应用
    for v in chain.iter().rev() {
        // 主类以子版本为准（Fabric 的 KnotClient 会覆盖原版 Main）
        if let Some(mc) = &v.main_class {
            out.main_class = Some(mc.clone());
        }
        if v.assets.is_some() {
            out.assets = v.assets.clone();
        }
        if v.asset_index.is_some() {
            out.asset_index = v.asset_index.clone();
        }
        if v.downloads.is_some() {
            out.downloads = v.downloads.clone();
        }
        if v.java_version.is_some() {
            out.java_version = v.java_version.clone();
        }
        if v.logging.is_some() {
            out.logging = v.logging.clone();
        }
        if v.minecraft_arguments.is_some() {
            out.minecraft_arguments = v.minecraft_arguments.clone();
        }
        if v.kind.is_some() {
            out.kind = v.kind.clone();
        }
        // 库：父在前，子追加（同 name 后者覆盖前者）
        for lib in &v.libraries {
            if let Some(pos) = out.libraries.iter().position(|l| l.name == lib.name) {
                out.libraries[pos] = lib.clone();
            } else {
                out.libraries.push(lib.clone());
            }
        }
        // 参数：父在前子在后
        match (&mut out.arguments, &v.arguments) {
            (_, None) => {}
            (None, Some(a)) => out.arguments = Some(a.clone()),
            (Some(dst), Some(src)) => {
                dst.game.extend(src.game.iter().cloned());
                dst.jvm.extend(src.jvm.iter().cloned());
            }
        }
    }
    out
}

/// 库的分类结果
pub struct LibPlan {
    /// 需要进 classpath 的 jar
    pub classpath: Vec<(PathBuf, Item)>,
    /// 需要解压的 natives jar
    pub natives: Vec<(PathBuf, Item, Vec<String>)>,
}

fn artifact_item(a: &Artifact, name: &str) -> Item {
    let rel = a.path.clone().unwrap_or_else(|| meta::maven_path(name));
    Item {
        url: if a.url.is_empty() {
            format!(
                "https://libraries.minecraft.net/{}",
                rel.trim_start_matches('/')
            )
        } else {
            a.url.clone()
        },
        dest: paths::libraries_dir().join(&rel),
        sha1: a.sha1.clone(),
        size: a.size,
    }
}

/// 根据当前平台把 libraries 拆成 classpath 与 natives。
/// source 保留在签名里给调用方传递下载源；实际 URL 改写统一在 download::one 里做。
pub fn plan_libs(v: &VersionJson, _source: Source) -> Result<LibPlan, String> {
    let mut classpath = Vec::new();
    let mut natives = Vec::new();
    let classifier = meta::natives_classifier();
    for lib in &v.libraries {
        if !meta::rules_allow(&lib.rules) {
            continue;
        }
        // Fabric 的库没有 downloads 段：仓库地址 + sha1 + size 直接挂在库上
        let dl_owned;
        let dl = match &lib.downloads {
            Some(d) => d,
            None => {
                let Some(repo) = &lib.url else { continue };
                let rel = meta::maven_path(&lib.name);
                dl_owned = super::meta::LibDownloads {
                    artifact: Some(Artifact {
                        path: Some(rel.clone()),
                        sha1: lib.sha1.clone(),
                        size: lib.size,
                        url: format!("{}/{rel}", repo.trim_end_matches('/')),
                    }),
                    classifiers: None,
                };
                &dl_owned
            }
        };
        // natives（新版）：classifier 形式
        let mut is_native = lib.name.ends_with(&format!(":{classifier}"));
        if let Some(map) = &lib.natives {
            // 老版本（1.12 及以前）：natives 字典 → classifiers
            let key = if cfg!(target_os = "windows") {
                "windows"
            } else if cfg!(target_os = "macos") {
                "osx"
            } else {
                "linux"
            };
            if map.contains_key(key) {
                is_native = true;
            }
        }
        if is_native {
            let art = dl
                .classifiers
                .as_ref()
                .and_then(|c| c.get(classifier).or_else(|| c.get("natives-linux")))
                .cloned();
            if let Some(art) = art {
                let exclude = lib
                    .extract
                    .as_ref()
                    .map(|e| e.exclude.clone())
                    .unwrap_or_default();
                let it = artifact_item(&art, &lib.name);
                natives.push((it.dest.clone(), it, exclude));
                continue;
            }
            if let Some(art) = &dl.artifact {
                // 有些版本把 natives jar 直接放 artifact
                let exclude = lib
                    .extract
                    .as_ref()
                    .map(|e| e.exclude.clone())
                    .unwrap_or_default();
                let it = artifact_item(art, &lib.name);
                natives.push((it.dest.clone(), it, exclude));
                continue;
            }
            continue;
        }
        if let Some(art) = &dl.artifact {
            let it = artifact_item(art, &lib.name);
            classpath.push((it.dest.clone(), it));
        }
    }
    Ok(LibPlan { classpath, natives })
}

/// 安装（或补全）一个原版实例。返回实例目录。
pub async fn install_vanilla(
    id: &str,
    source: Source,
    concurrency: usize,
    progress: ProgressFn<'_>,
) -> Result<PathBuf, String> {
    paths::ensure_all().map_err(|e| format!("创建数据目录失败: {e}"))?;
    progress(super::pct(1.0, format!("解析 {id} 元数据…")));
    let chain = resolve_chain(id, source).await?;
    let merged = merge(&chain, id);
    let dir = paths::version_dir(id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // 1. 库
    let plan = plan_libs(&merged, source)?;
    let mut items: Vec<Item> = plan.classpath.iter().map(|(_, i)| i.clone()).collect();
    items.extend(plan.natives.iter().map(|(_, i, _)| i.clone()));
    progress(super::pct(5.0, format!("下载 {} 个依赖库…", items.len())));
    download::fetch_all(items, source, concurrency, progress).await?;

    // 2. 主 jar
    let client_art = merged
        .downloads
        .as_ref()
        .and_then(|d| d.client.clone())
        .ok_or_else(|| format!("{id} 的元数据里没有 client jar（可能是旧格式）"))?;
    let jar_path = dir.join(format!("{id}.jar"));
    progress(super::pct(60.0, "下载游戏主程序…"));
    download::fetch_all(
        vec![Item {
            url: client_art.url.clone(),
            dest: jar_path.clone(),
            sha1: client_art.sha1.clone(),
            size: client_art.size,
        }],
        source,
        concurrency,
        progress,
    )
    .await?;

    // 3. natives 解压
    let natives_dir = dir.join("natives");
    if natives_dir.exists() {
        let _ = std::fs::remove_dir_all(&natives_dir);
    }
    std::fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;
    progress(super::pct(70.0, "解压本地库（natives）…"));
    for (path, _, exclude) in &plan.natives {
        extract_natives(path, &natives_dir, exclude)?;
    }

    // 4. 资源
    if let Some(ai) = &merged.asset_index {
        progress(super::pct(80.0, "下载游戏资源（首次约 300~600 MB）…"));
        install_assets(ai, source, concurrency, progress).await?;
    }

    // 5. 落最终 version json（供启动时复用）
    let final_json = serde_json::to_vec_pretty(&merged).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{id}.json")), final_json).map_err(|e| e.to_string())?;

    progress(super::pct(100.0, format!("{id} 安装完成")));
    Ok(dir)
}

/// 解压 natives jar，跳过 META-INF 与 extract.exclude
pub fn extract_natives(jar: &Path, dest: &Path, exclude: &[String]) -> Result<(), String> {
    if !jar.is_file() {
        return Ok(());
    }
    let f = std::fs::File::open(jar).map_err(|e| format!("打开 {} 失败: {e}", jar.display()))?;
    let mut zip =
        zip::ZipArchive::new(f).map_err(|e| format!("{} 不是合法 zip: {e}", jar.display()))?;
    for i in 0..zip.len() {
        let mut entry = match zip.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let Some(raw) = entry.enclosed_name() else {
            continue;
        };
        let name = raw.to_string_lossy().to_string();
        if name.starts_with("META-INF/") || name.ends_with('/') {
            continue;
        }
        if exclude.iter().any(|e| name.starts_with(e)) {
            continue;
        }
        let lower = name.to_lowercase();
        if !(lower.ends_with(".so")
            || lower.ends_with(".dll")
            || lower.ends_with(".dylib")
            || lower.ends_with(".jnilib"))
        {
            continue;
        }
        // 只取文件名，各级目录拉平（MC 官方启动器同样做法）
        let base = Path::new(&name)
            .file_name()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("lib"));
        let out = dest.join(base);
        let mut buf = Vec::new();
        use std::io::Read;
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, &buf).map_err(|e| format!("写 {} 失败: {e}", out.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755));
        }
    }
    Ok(())
}

/// 安装资源索引与 objects
pub async fn install_assets(
    ai: &meta::AssetIndex,
    source: Source,
    concurrency: usize,
    progress: ProgressFn<'_>,
) -> Result<(), String> {
    let index_path = paths::indexes_dir().join(format!("{}.json", ai.id));
    let need_index = match (&ai.sha1, index_path.is_file()) {
        (Some(h), true) => download::sha1_file(&index_path)
            .map(|g| !g.eq_ignore_ascii_case(h))
            .unwrap_or(true),
        (_, true) => false,
        _ => true,
    };
    if need_index {
        let text = download::fetch_text(&ai.url, source).await?;
        if let Some(dir) = index_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&index_path, text).map_err(|e| format!("写资源索引失败: {e}"))?;
    }
    let body = std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let parsed: meta::AssetIndexJson =
        serde_json::from_str(&body).map_err(|e| format!("资源索引解析失败: {e}"))?;
    let mut items = Vec::new();
    for (name, obj) in &parsed.objects {
        if obj.hash.len() < 2 {
            continue;
        }
        let prefix = &obj.hash[0..2];
        items.push(Item {
            url: format!("{}/{}/{}", meta::RESOURCES_URL, prefix, obj.hash),
            dest: paths::objects_dir().join(prefix).join(&obj.hash),
            sha1: Some(obj.hash.clone()),
            size: Some(obj.size),
        });
        let _ = name;
    }
    download::fetch_all(items, source, concurrency, progress).await?;
    Ok(())
}

/// 实例是否已装（目录里有最终 json 与 jar，或 fabric 情况只有 json）
pub fn is_installed(id: &str) -> bool {
    let d = paths::version_dir(id);
    d.join(format!("{id}.json")).is_file()
}

pub fn installed_ids() -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(paths::versions_dir()) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
        .filter(|id| is_installed(id))
        .collect();
    ids.sort();
    ids
}

/// 计算目录指纹（用于判断文件是否被改过）
pub fn dir_fingerprint(dir: &Path) -> String {
    let mut h = Sha256::new();
    h.update(dir.display().to_string().as_bytes());
    format!("{:x}", h.finalize())[..16].to_string()
}
