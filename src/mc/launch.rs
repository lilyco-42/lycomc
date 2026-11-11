//! 启动实例：把 version json 组装成一条真的 java 命令行，并把日志落盘。
//!
//! 关键点（踩过的坑都写在这里）：
//!   * 离线启动必须同时给 --uuid 与 --accessToken，缺一个 1.20+ 直接崩；
//!   * natives 不是独立 jar，得先解压到独立目录再 -Djava.library.path；
//!   * fabric 实例复用父版本的 client jar（自己的目录里没有 jar）；
//!   * 参数表里混着「带 rules 的对象」与「纯字符串」，必须逐项求值。

use std::path::{Path, PathBuf};

use super::java;
use super::meta::{self, Rule, Source, VersionJson};
use super::{paths, OfflineAccount, ProgressFn};

/// 启动参数
#[derive(Debug, Clone)]
pub struct LaunchOpts {
    pub id: String,
    pub account: OfflineAccount,
    pub memory_mb: u32,
    /// 用户在设置里指定了 java 就用它
    pub java_path: Option<String>,
    pub extra_jvm: Vec<String>,
    pub source: Source,
    pub concurrency: usize,
    /// 游戏界面语言：启动前写进 options.txt 的 lang:
    pub game_lang: String,
}

/// 组装好的启动计划（不含进程，便于先展示「将执行什么」再真跑）
#[derive(Debug, Clone)]
pub struct Prepared {
    pub program: String,
    pub args: Vec<String>,
    pub game_dir: PathBuf,
    pub log_path: PathBuf,
    pub version_id: String,
    pub java_version: u32,
    pub java_source: String,
}

impl Prepared {
    /// 一行人类可读的命令（日志里给人看）
    pub fn display_cmd(&self) -> String {
        let mut s = self.program.clone();
        for a in &self.args {
            if a.len() > 120 {
                s.push_str(" <长参数>");
            } else {
                s.push(' ');
                s.push_str(a);
            }
        }
        s
    }
}

/// 读本地某个实例的 json 文件（只读已落盘的，不联网）
fn read_local(id: &str) -> Result<VersionJson, String> {
    let p = paths::version_dir(id).join(format!("{id}.json"));
    if !p.is_file() {
        return Err(format!("实例 {id} 尚未安装（缺少 {}）", p.display()));
    }
    meta::read_version_json(&p)
}

/// 装配一个可启动的版本：Fabric 这类带 inheritsFrom 的实例，
/// 要沿本地父链合并库与参数（父版本 json 安装时已落盘）。
pub fn resolved(id: &str) -> Result<VersionJson, String> {
    let mut chain = vec![read_local(id)?];
    let mut guard = 0;
    loop {
        guard += 1;
        if guard > 8 {
            return Err("版本继承链过深（疑似元数据损坏）".into());
        }
        let parent = match chain.last().and_then(|v| v.inherits_from.clone()) {
            Some(p) => p,
            None => break,
        };
        chain.push(read_local(&parent)?);
    }
    let direct_parent = chain[0].inherits_from.clone();
    if chain.len() == 1 && direct_parent.is_none() {
        return Ok(chain.remove(0));
    }
    let mut merged = super::install::merge(&chain, id);
    // 合并后仍要记住直接父版本：主 jar 与 assets 在父版本目录里
    merged.inherits_from = direct_parent;
    Ok(merged)
}

/// 读实例 json（安装时已落盘，绝不在这里重新解析远程元数据）
pub fn instance_json(id: &str) -> Result<(VersionJson, PathBuf), String> {
    let dir = paths::version_dir(id);
    let p = dir.join(format!("{id}.json"));
    if !p.is_file() {
        return Err(format!("实例 {id} 尚未安装（缺少 {}）", p.display()));
    }
    Ok((meta::read_version_json(&p)?, dir))
}

/// 确保 natives 目录里有本地库：空的就按合并后的库表解一遍。
fn ensure_natives(v: &VersionJson, natives: &Path) -> Result<(), String> {
    let has_lib = std::fs::read_dir(natives)
        .map(|rd| rd.flatten().any(|e| e.path().is_file()))
        .unwrap_or(false);
    if has_lib {
        return Ok(());
    }
    let plan = super::install::plan_libs(v, Source::Mojang)?;
    if plan.natives.is_empty() {
        return Ok(());
    }
    for (jar, _, exclude) in &plan.natives {
        super::install::extract_natives(jar, natives, exclude)?;
    }
    Ok(())
}

/// 主 jar 路径：自己的目录里没有就找父版本（fabric 情况）
pub fn client_jar(v: &VersionJson, id: &str) -> Result<PathBuf, String> {
    let own = paths::version_dir(id).join(format!("{id}.jar"));
    if own.is_file() {
        return Ok(own);
    }
    if let Some(parent) = &v.inherits_from {
        let p = paths::version_dir(parent).join(format!("{parent}.jar"));
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(format!("{id} 找不到游戏主 jar，请重新安装"))
}

fn subst(input: &str, vars: &[(&str, String)]) -> String {
    let mut out = input.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("${{{k}}}"), v);
    }
    out
}

/// 参数表展开：纯字符串直接用，带 rules 的对象先求值
fn expand(list: &[serde_json::Value]) -> Vec<String> {
    let mut out = Vec::new();
    for item in list {
        match item {
            serde_json::Value::String(s) => out.push(s.clone()),
            serde_json::Value::Object(m) => {
                let rules: Option<Vec<Rule>> = m
                    .get("rules")
                    .and_then(|r| serde_json::from_value(r.clone()).ok());
                if !meta::rules_allow(&rules) {
                    continue;
                }
                match m.get("value") {
                    Some(serde_json::Value::String(s)) => out.push(s.clone()),
                    Some(serde_json::Value::Array(a)) => {
                        for x in a {
                            if let Some(s) = x.as_str() {
                                out.push(s.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    out
}

/// classpath：所有存在的库 jar + 主 jar（顺序敏感，主 jar 放最后）
pub fn classpath(v: &VersionJson, id: &str) -> Result<(String, Vec<PathBuf>), String> {
    let plan = super::install::plan_libs(v, Source::Mojang)?;
    let mut jars: Vec<PathBuf> = plan.classpath.iter().map(|(p, _)| p.clone()).collect();
    jars.push(client_jar(v, id)?);
    let mut kept = Vec::new();
    let mut missing = Vec::new();
    for j in jars {
        if j.is_file() {
            kept.push(j);
        } else {
            missing.push(j.display().to_string());
        }
    }
    if !missing.is_empty() {
        return Err(format!("缺少 {} 个依赖库（例如 {}），请重新安装版本", missing.len(), missing[0]));
    }
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let joined = kept
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(sep);
    Ok((joined, kept))
}

/// 组装启动计划。会按需准备 Java（本机没有就下托管 JRE）。
pub async fn prepare(opts: &LaunchOpts, progress: ProgressFn<'_>) -> Result<Prepared, String> {
    let (raw, dir) = instance_json(&opts.id)?;
    let v = resolved(&opts.id)?;
    let _ = &raw;
    let required = v.java_version.as_ref().map(|j| j.major_version).unwrap_or(17);
    progress(super::pct(4.0, format!("检查 Java {required}…")));
    let java_bin = match opts.java_path.as_deref() {
        Some(p) if !p.trim().is_empty() => {
            let p = PathBuf::from(p.trim());
            match java::probe(&p) {
                Some(i) => {
                    if i.version != required {
                        progress(super::logline(
                            6.0,
                            format!("警告：设置里指定的 Java {} 与版本要求 {} 不一致，照用", i.version, required),
                        ));
                    }
                    (p, i.version, "settings".to_string())
                }
                None => return Err(format!("设置的 Java 路径不可用: {}", p.display())),
            }
        }
        _ => {
            let p = java::ensure(required, opts.source, progress).await?;
            let i = java::probe(&p);
            (p, i.as_ref().map(|x| x.version).unwrap_or(required), "auto".to_string())
        }
    };

    let natives = dir.join("natives");
    std::fs::create_dir_all(&natives).map_err(|e| format!("创建 natives 目录失败: {e}"))?;
    // Fabric 这类继承实例自己不带 natives（都在父版本里），
    // 启动前把合并后的 natives 解到本实例目录，否则 LWJGL 找不到 liblwjgl.so。
    ensure_natives(&v, &natives)?;
    let (cp, _) = classpath(&v, &opts.id)?;
    let assets_root = paths::assets_dir().display().to_string();
    let assets_index = v
        .assets
        .clone()
        .or_else(|| v.asset_index.as_ref().map(|a| a.id.clone()))
        .unwrap_or_else(|| "legacy".to_string());
    let kind = v.kind.clone().unwrap_or_else(|| "release".to_string());
    let game_dir = dir.clone();
    // 每次启动都把设置里的语言写回 options.txt：游戏与 Mod 界面默认中文。
    // 写失败只警告，不阻断启动（实例目录可能是只读的）。
    if let Err(e) = super::options::set_lang(&opts.id, &opts.game_lang) {
        progress(super::logline(8.0, format!("写入游戏语言失败（不影响启动）: {e}")));
    }
    let launcher_version = env!("CARGO_PKG_VERSION").to_string();

    let vars: Vec<(&str, String)> = vec![
        ("auth_player_name", opts.account.name.clone()),
        ("version_name", opts.id.clone()),
        ("game_directory", game_dir.display().to_string()),
        ("assets_root", assets_root.clone()),
        ("game_assets", assets_root),
        ("assets_index_name", assets_index),
        ("auth_uuid", opts.account.uuid.clone()),
        ("auth_access_token", "lycomcofflinetoken0000000000000000".to_string()),
        ("auth_session", "lycomcofflinetoken0000000000000000".to_string()),
        ("user_type", "legacy".to_string()),
        ("version_type", kind),
        ("natives_directory", natives.display().to_string()),
        ("classpath", cp),
        ("launcher_name", "lycomc".to_string()),
        ("launcher_version", launcher_version),
        ("clientid", String::new()),
        ("auth_xuid", String::new()),
        ("user_properties", "{}".to_string()),
        ("library_directory", paths::libraries_dir().display().to_string()),
        ("classpath_separator", if cfg!(target_os = "windows") { ";".to_string() } else { ":".to_string() }),
    ];

    let mut jvm: Vec<String> = Vec::new();
    match &v.arguments {
        Some(a) => {
            for raw in expand(&a.jvm) {
                jvm.push(subst(&raw, &vars));
            }
        }
        None => {
            // 极老版本（1.12 及以前）：jvm 参数是固定套路
            jvm.push("-Djava.library.path=${natives_directory}".to_string());
            jvm.push("-cp".to_string());
            jvm.push("${classpath}".to_string());
        }
    }

    // 内存：json 里自带 -Xmx2G，我们的追加在后面因此生效
    jvm.push(format!("-Xmx{}M", opts.memory_mb.max(512)));
    for extra in &opts.extra_jvm {
        let t = extra.trim();
        if !t.is_empty() {
            jvm.push(t.to_string());
        }
    }
    // log4j 配置（有就带上，缺文件也不致命）
    if let Some(lc) = v.logging.as_ref().and_then(|l| l.client.as_ref()) {
        if let (Some(arg), Some(file)) = (lc.argument.as_ref(), lc.file.as_ref()) {
            let rel = file
                .path
                .clone()
                .unwrap_or_else(|| "client-1.12.xml".to_string());
            let p = paths::assets_dir().join("log_configs").join(&rel);
            let _ = std::fs::create_dir_all(p.parent().unwrap_or(&paths::assets_dir()));
            if !p.is_file() {
                if let Ok(url) = {
                    let u = if file.url.is_empty() {
                        format!("https://piston-data.mojang.com/{}", rel)
                    } else {
                        file.url.clone()
                    };
                    Ok::<String, String>(u)
                } {
                    if let Ok(body) = super::download::fetch_text(&url, opts.source).await {
                        let _ = std::fs::write(&p, body);
                    }
                }
            }
            jvm.push(subst(arg, &[("path", p.display().to_string())]));
        }
    }

    // 游戏参数
    let mut game: Vec<String> = Vec::new();
    match &v.arguments {
        Some(a) => {
            for raw in expand(&a.game) {
                game.push(subst(&raw, &vars));
            }
        }
        None => {
            let legacy = v.minecraft_arguments.clone().unwrap_or_default();
            for raw in legacy.split_whitespace() {
                game.push(subst(raw, &vars));
            }
        }
    }
    if game.is_empty() {
        return Err(format!("{} 的参数表为空，元数据可能损坏", opts.id));
    }

    let main_class = v.main_class.clone().ok_or_else(|| format!("{} 缺少 mainClass", opts.id))?;
    let mut args = jvm;
    args.push(main_class);
    args.extend(game);

    let log_path = paths::logs_dir().join(format!("{}-{}.log", opts.id, timestamp()));
    if let Some(d) = log_path.parent() {
        let _ = std::fs::create_dir_all(d);
    }

    progress(super::pct(10.0, "启动命令已就绪"));
    Ok(Prepared {
        program: java_bin.0.display().to_string(),
        args,
        game_dir,
        log_path,
        version_id: opts.id.clone(),
        java_version: java_bin.1,
        java_source: java_bin.2,
    })
}

pub fn timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{now}")
}

/// 供 /api/logs 用：日志路径 -> 最后若干行
pub fn tail(path: &Path, max: usize) -> Vec<String> {
    let Ok(t) = std::fs::read_to_string(path) else { return Vec::new() };
    let lines: Vec<String> = t.lines().map(|s| s.to_string()).collect();
    let start = lines.len().saturating_sub(max);
    lines[start..].to_vec()
}

/// 实例目录里的 mods/
pub fn mods_dir(id: &str) -> PathBuf {
    paths::version_dir(id).join("mods")
}
// ── 进程 ───────────────────────────────────────────────────────

/// 真起进程：stdout/stderr 追加进日志文件，返回 Child 由调用方持有（便于 kill）。
///
/// 用 std::process 而不是 tokio::process，是因为启动器要能在 tokio 之外
/// 的 CLI/TUI 前端也复用同一段代码，而且 kill 是同步语义。
pub fn spawn(p: &Prepared) -> Result<std::process::Child, String> {
    use std::process::{Command, Stdio};
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&p.log_path)
        .map_err(|e| format!("打开日志文件失败: {e}"))?;
    let log2 = log.try_clone().map_err(|e| format!("复制日志句柄失败: {e}"))?;
    let child = Command::new(&p.program)
        .args(&p.args)
        .current_dir(&p.game_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log2))
        .spawn()
        .map_err(|e| format!("启动 java 失败: {e}"))?;
    Ok(child)
}

