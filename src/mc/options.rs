//! 读写 <实例目录>/options.txt：游戏语言（lang）与已启用资源包（resourcePacks）。
//!
//! Minecraft 的 options.txt 每行 key:value，# 开头是注释；resourcePacks 是
//! JSON 字符串数组（外部包写作 "file/<文件名>"）。这里只改关心的两行，其余
//! 原样保留；写入走 tmp + rename，避免半个文件被游戏读到。

use std::path::PathBuf;

/// 我们投放的汉化资源包文件名前缀，用来判断实例是否已汉化。
pub const PACK_PREFIX: &str = "lycomc-";

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub lang: Option<String>,
    pub resource_packs: Vec<String>,
    /// 其它配置项（原样保留，按原文件顺序）
    other: Vec<String>,
}

fn file_of(id: &str) -> PathBuf {
    super::launch::game_dir(id).join("options.txt")
}

fn parse_packs(v: &str) -> Vec<String> {
    let t = v.trim();
    if let Ok(arr) = serde_json::from_str::<Vec<String>>(t) {
        return arr;
    }
    // 极老版本（1.12 及以前）是逗号分隔、没有 JSON 引号
    t.trim_matches(|c| c == '[' || c == ']')
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn read(id: &str) -> Options {
    let mut o = Options::default();
    let Ok(text) = std::fs::read_to_string(file_of(id)) else {
        return o;
    };
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            o.other.push(line.to_string());
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            o.other.push(line.to_string());
            continue;
        };
        match k.trim() {
            "lang" => o.lang = Some(v.trim().to_string()),
            "resourcePacks" => o.resource_packs = parse_packs(v),
            _ => o.other.push(line.to_string()),
        }
    }
    o
}

pub fn write(id: &str, o: &Options) -> Result<(), String> {
    let p = file_of(id);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("创建实例目录失败: {e}"))?;
    }
    let mut out = String::new();
    for line in &o.other {
        out.push_str(line);
        out.push('\n');
    }
    if let Some(lang) = &o.lang {
        out.push_str("lang:");
        out.push_str(lang);
        out.push('\n');
    }
    out.push_str("resourcePacks:");
    out.push_str(&serde_json::to_string(&o.resource_packs).map_err(|e| e.to_string())?);
    out.push('\n');
    let tmp = p.with_extension("txt.tmp");
    std::fs::write(&tmp, out).map_err(|e| format!("写 options.txt 失败: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("提交 options.txt 失败: {e}"))?;
    Ok(())
}

/// 启动前把设置里的语言写进 options.txt（不动资源包与其它配置）。
pub fn set_lang(id: &str, lang: &str) -> Result<(), String> {
    let mut o = read(id);
    if o.lang.as_deref() == Some(lang) {
        return Ok(());
    }
    o.lang = Some(lang.to_string());
    write(id, &o)
}

/// 汉化完成时：设置语言并启用我们投放的资源包（保留用户已有的其它包）。
pub fn enable_packs(id: &str, names: &[String], lang: &str) -> Result<(), String> {
    let mut o = read(id);
    o.lang = Some(lang.to_string());
    let prefix = format!("file/{PACK_PREFIX}");
    // 去掉旧版本留下的 lycomc- 包，再按给定顺序追加（后面优先级更高）
    o.resource_packs.retain(|p| !p.starts_with(&prefix));
    for n in names {
        let entry = format!("file/{n}");
        if !o.resource_packs.contains(&entry) {
            o.resource_packs.push(entry);
        }
    }
    write(id, &o)
}

/// GET /api/versions/:id 与 /api/state 用：lang / resourcePacks / localized。
/// localized 要求「options.txt 里确实启用、且 zip 还在磁盘上」——用户在游戏内
/// 手动关掉资源包后会如实显示未汉化。
pub fn status(id: &str) -> (Option<String>, Vec<String>, bool) {
    let o = read(id);
    let dir = super::launch::game_dir(id).join("resourcepacks");
    let prefix = format!("file/{PACK_PREFIX}");
    let localized = o.resource_packs.iter().any(|p| {
        p.starts_with(&prefix)
            && p.strip_prefix("file/")
                .map(|n| dir.join(n).is_file())
                .unwrap_or(false)
    });
    (o.lang, o.resource_packs, localized)
}
