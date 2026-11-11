//! 一键汉化：下载中文资源包并写进 options.txt。
//!
//! 两个来源（都只下载、绝不内嵌进二进制，遵守各自授权）：
//!   * CFPAOrg/Minecraft-Mod-Language-Package —— CC BY-NC-SA 4.0，覆盖绝大多数
//!     Mod 的 assets/<ns>/lang/zh_cn.json；GitHub release 走国内代理 + 直连回落。
//!   * Modrinth c6ZgwIPR「钠-汉化包」—— MIT，补 CFPA 没收录的 Sodium 本体词条。
//!     它是可选增强，失败只警告，不影响整体汉化。
//!
//! Modrinth API/CDN 失败时自动回落 MCIM 国内镜像（见 modrinth.rs / download.rs）。

use std::io::{Cursor, Read, Write};
use std::path::Path;

use serde_json::{json, Value};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use super::{launch, meta, modrinth, options, paths, ProgressFn};

const CFPA_RELEASE: &str =
    "https://github.com/CFPAOrg/Minecraft-Mod-Language-Package/releases/download/autobuild";
const CFPA_ALL: &str = "Minecraft-Mod-Language-Modpack.zip";
const PACK_CFPA: &str = "lycomc-cfpa-zh.zip";
const PACK_SODIUM: &str = "lycomc-sodium-zh.zip";
const SODIUM_PROJECT: &str = "c6ZgwIPR";

/// 按 MC 大版本 + 装载器挑 CFPA 分包；其它版本用全量包。
fn cfpa_asset(gv: &str, fabric: bool) -> &'static str {
    if gv.starts_with("1.20") {
        if fabric {
            "Minecraft-Mod-Language-Modpack-1-20-Fabric.zip"
        } else {
            "Minecraft-Mod-Language-Modpack-1-20.zip"
        }
    } else if gv.starts_with("1.21") {
        if fabric {
            "Minecraft-Mod-Language-Modpack-1-21-Fabric.zip"
        } else {
            CFPA_ALL
        }
    } else if gv.starts_with("1.19") {
        "Minecraft-Mod-Language-Modpack-1-19.zip"
    } else {
        CFPA_ALL
    }
}

fn cfpa_urls(asset: &str) -> Vec<String> {
    let direct = format!("{CFPA_RELEASE}/{asset}");
    vec![
        format!("https://gh-proxy.com/{direct}"),
        format!("https://ghfast.top/{direct}"),
        format!("https://hk.gh-proxy.com/{direct}"),
        direct,
    ]
}

/// 下载后必须能当 zip 打开且有 pack.mcmeta，别把 400 错误页当成资源包存盘。
fn valid_zip(bytes: &[u8]) -> bool {
    let Ok(mut z) = zip::ZipArchive::new(Cursor::new(bytes)) else {
        return false;
    };
    // 必须先把 Result<ZipFile> 这个临时值收进局部变量：否则它活到语句尾，
    // 借用会越过 z 的析构（E0597）。
    let found = z.by_name("pack.mcmeta").is_ok();
    found
}


/// 从已落盘的 client jar 里读 version.json 的 pack_version.resource；
/// 读不到就按 MC 版本号猜（1.20.x=15、1.19.x=13、1.21.x=34…）。
fn resource_pack_format(v: &meta::VersionJson, id: &str) -> u32 {
    let try_read = || -> Option<u32> {
        let jar = launch::client_jar(v, id).ok()?;
        let f = std::fs::File::open(jar).ok()?;
        let mut z = zip::ZipArchive::new(f).ok()?;
        let mut raw = String::new();
        z.by_name("version.json").ok()?.read_to_string(&mut raw).ok()?;
        let j: Value = serde_json::from_str(&raw).ok()?;
        let n = j.get("pack_version")?.get("resource")?.as_u64()?;
        Some(n as u32)
    };
    if let Some(n) = try_read() {
        return n;
    }
    let gv = v.inherits_from.as_deref().unwrap_or(&v.id);
    match () {
        _ if gv.starts_with("1.20") => 15,
        _ if gv.starts_with("1.21") => 34,
        _ if gv.starts_with("1.19") => 13,
        _ if gv.starts_with("1.18") => 9,
        _ => 15,
    }
}

/// 把 pack.mcmeta 的 pack_format（以及 supported_formats）改成当前 MC 能接受的格式，
/// 其余 zip 条目用 raw_copy_file 原样搬运。资源包只是 lang json，改格式不改内容。
fn rewrite_pack_format(path: &Path, fmt: u32) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    let mut src = ZipArchive::new(Cursor::new(&bytes))
        .map_err(|e| format!("打开资源包失败: {e}"))?;

    let mut mcmeta: Value = {
        let mut f = src.by_name("pack.mcmeta").map_err(|e| format!("缺 pack.mcmeta: {e}"))?;
        let mut raw = String::new();
        f.read_to_string(&mut raw).map_err(|e| format!("读 pack.mcmeta 失败: {e}"))?;
        // 有些作者会在 JSON 之后追加 // 注释（Sodium 包就有），截到最后一个 } 再解析。
        let end = raw.rfind('}').map(|i| i + 1).unwrap_or(raw.len());
        serde_json::from_str(&raw[..end]).map_err(|e| format!("解析 pack.mcmeta 失败: {e}"))?
    };
    let pack = mcmeta
        .get_mut("pack")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "pack.mcmeta 缺 pack 对象".to_string())?;
    pack.insert("pack_format".into(), json!(fmt));
    pack.insert("supported_formats".into(), json!({"min_inclusive": fmt, "max_inclusive": fmt}));
    let new_meta = serde_json::to_vec_pretty(&mcmeta).map_err(|e| format!("序列化 pack.mcmeta 失败: {e}"))?;

    let tmp = path.with_extension("zip.tmp");
    let out = std::fs::File::create(&tmp).map_err(|e| format!("创建临时包失败: {e}"))?;
    let mut dst = ZipWriter::new(out);
    for i in 0..src.len() {
        let f = src.by_index_raw(i).map_err(|e| format!("读资源包条目失败: {e}"))?;
        let name = f.name().to_string();
        if name == "pack.mcmeta" {
            dst.start_file("pack.mcmeta", SimpleFileOptions::default())
                .map_err(|e| format!("写入 pack.mcmeta 失败: {e}"))?;
            dst.write_all(&new_meta).map_err(|e| format!("写入 pack.mcmeta 失败: {e}"))?;
        } else {
            dst.raw_copy_file(f).map_err(|e| format!("复制资源包条目失败: {e}"))?;
        }
    }
    dst.finish().map_err(|e| format!("收尾资源包失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换资源包失败: {e}"))?;
    Ok(())
}

async fn fetch_pack(urls: &[String], dest: &Path) -> Result<u64, String> {
    let c = meta::client();
    if let Some(d) = dest.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("创建 resourcepacks 目录失败: {e}"))?;
    }
    let mut last = String::from("没有可用的下载地址");
    for url in urls {
        let resp = match c.get(url).send().await {
            Ok(r) => r,
            Err(e) => {
                last = format!("{url}: {e}");
                continue;
            }
        };
        if !resp.status().is_success() {
            last = format!("{url}: HTTP {}", resp.status());
            continue;
        }
        match resp.bytes().await {
            Ok(b) if valid_zip(&b) => {
                std::fs::write(dest, &b)
                    .map_err(|e| format!("写入 {} 失败: {e}", dest.display()))?;
                return Ok(b.len() as u64);
            }
            Ok(_) => last = format!("{url}: 不是有效资源包（缺 pack.mcmeta）"),
            Err(e) => last = format!("{url}: {e}"),
        }
    }
    Err(last)
}

async fn sodium_pack(
    gv: &str,
    v: &meta::VersionJson,
    id: &str,
    dest: &Path,
    progress: ProgressFn<'_>,
) -> Result<u64, String> {
    progress(super::pct(66.0, "查询 Sodium 中文包…"));
    let mv = modrinth::pick_version(SODIUM_PROJECT, gv, "minecraft").await?;
    let f = mv
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| mv.files.first())
        .ok_or_else(|| "Sodium 中文包没有可下载文件".to_string())?;
    let mut urls = Vec::new();
    if let Some(m) = modrinth::mirror_cdn(&f.url) {
        urls.push(m);
    }
    urls.push(f.url.clone());
    progress(super::pct(72.0, format!("下载 Sodium 中文包 {}…", f.filename)));
    let size = fetch_pack(&urls, dest).await?;
    let fmt = resource_pack_format(v, id);
    rewrite_pack_format(dest, fmt)?;
    progress(super::pct(84.0, format!("Sodium 中文包已适配资源包格式 {fmt}")));
    Ok(size)
}

/// POST /api/localize 的异步任务；进度走既有 /api/events SSE。
pub async fn run(
    id: &str,
    lang: &str,
    _source: meta::Source,
    progress: ProgressFn<'_>,
) -> Result<Value, String> {
    if id.contains('/') || id.contains("..") {
        return Err("非法版本 id".into());
    }
    let (v, _) = launch::instance_json(id)?;
    let fabric = v.inherits_from.is_some();
    let gv = v.inherits_from.clone().unwrap_or_else(|| v.id.clone());
    let dir = paths::version_dir(id).join("resourcepacks");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 resourcepacks 目录失败: {e}"))?;

    progress(super::pct(5.0, format!("准备汉化 {id}（{gv}）…")));

    // 1) CFPA 万用汉化包：必需
    let asset = cfpa_asset(&gv, fabric);
    progress(super::pct(15.0, format!("下载 CFPA 汉化包 {asset}…")));
    let cfpa_dest = dir.join(PACK_CFPA);
    let size = match fetch_pack(&cfpa_urls(asset), &cfpa_dest).await {
        Ok(n) => n,
        Err(e) if asset != CFPA_ALL => {
            progress(super::logline(20.0, format!("{asset} 不可用，改用 CFPA 全量包：{e}")));
            fetch_pack(&cfpa_urls(CFPA_ALL), &cfpa_dest).await?
        }
        Err(e) => return Err(format!("CFPA 汉化包下载失败: {e}")),
    };
    progress(super::pct(
        60.0,
        format!("CFPA 汉化包已就绪（{:.1} MB）", size as f64 / 1_048_576.0),
    ));

    // 2) Sodium 中文包：可选
    let mut packs = vec![PACK_CFPA.to_string()];
    match sodium_pack(&gv, &v, id, &dir.join(PACK_SODIUM), progress).await {
        Ok(n) => {
            packs.push(PACK_SODIUM.to_string());
            progress(super::pct(
                86.0,
                format!("Sodium 中文包已就绪（{:.1} MB）", n as f64 / 1_048_576.0),
            ));
        }
        Err(e) => progress(super::logline(
            86.0,
            format!("Sodium 中文包略过（不影响其它 Mod 汉化）：{e}"),
        )),
    }

    // 3) 写 options.txt：语言 + 启用资源包
    progress(super::pct(92.0, "写入 options.txt（语言与资源包）…"));
    options::enable_packs(id, &packs, lang)?;
    progress(super::pct(100.0, "汉化完成，下次启动即为中文"));
    Ok(json!({
        "versionId": id,
        "lang": lang,
        "packs": packs,
        "localized": true,
    }))
}


#[cfg(test)]
mod mirror_tests {
    use super::cfpa_urls;

    #[test]
    fn cfpa_uses_three_proxies_then_direct() {
        let urls = cfpa_urls("Minecraft-Mod-Language-Modpack-1-20-Fabric.zip");
        assert_eq!(urls.len(), 4);
        assert!(urls[0].starts_with("https://gh-proxy.com/"));
        assert!(urls[1].starts_with("https://ghfast.top/"));
        assert!(urls[2].starts_with("https://hk.gh-proxy.com/"));
        assert!(urls[3].starts_with("https://github.com/CFPAOrg/"));
    }
}
