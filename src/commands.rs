//! lilyco 命令面：CLI / TUI / MCP 三个前端共用同一套命令定义。
//!
//! Web 控制台走自己的 REST 接口（见 api.rs），但它能做的事与这里一一对应，
//! 所以「命令行能做什么」与「AI 能做什么」永远是同一份真相。

use std::sync::Arc;

use lilyco::prelude::*;
use serde_json::{json, Value};

use crate::mc::{self, auth, fabric, install, instances, java, launch, modrinth, paths, Progress};
use crate::settings;

/// 命令面是同步的（lilyco 的 App trait 如此），内核是 async 的 ——
/// 每次调用开一个当前线程运行时，够用且不引入额外线程池。
fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(f)
}

/// 把内核进度搬到 CLI/TUI 的日志与进度条上
fn reporter<'a>(ctx: &'a Context) -> impl Fn(Progress) + Send + Sync + 'a {
    move |p: Progress| {
        if let Some(line) = &p.log {
            ctx.log(LogLevel::Info, line.clone());
        }
        ctx.tick((p.percent * 100.0) as u64, Some(10_000), p.message);
    }
}

// ── 实例 ───────────────────────────────────────────────────────

#[derive(App)]
#[app(
    name = "list",
    about = "列出已安装的实例（原版与 Fabric）",
    run = "run_list"
)]
pub struct ListCmd {}

fn run_list(_app: &ListCmd, ctx: &Context) -> Result<Value, AppError> {
    let ids = install::installed_ids();
    if ids.is_empty() {
        ctx.log(
            LogLevel::Warn,
            "还没有安装任何实例，先跑 lycomc install <版本>",
        );
    }
    let mut items = Vec::new();
    for id in &ids {
        let Ok((v, _)) = launch::instance_json(id) else {
            continue;
        };
        let base = v.inherits_from.clone();
        let kind = if base.is_some() { "fabric" } else { "vanilla" };
        let jv = v
            .java_version
            .as_ref()
            .map(|j| j.major_version)
            .unwrap_or(17);
        ctx.log(LogLevel::Info, format!("{id:<32} {kind:<8} java {jv}"));
        items.push(json!({
            "id": id,
            "kind": kind,
            "baseVersion": base.unwrap_or_else(|| id.clone()),
            "javaMajor": jv,
        }));
    }
    let out = json!({ "versions": items });
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(
    name = "info",
    about = "查看某个实例的详情与日志位置",
    run = "run_info"
)]
pub struct InfoCmd {
    /// 实例 id，例如 1.20.1 或 fabric-loader-0.16.9-1.20.1
    pub version_id: String,
}

fn run_info(app: &InfoCmd, ctx: &Context) -> Result<Value, AppError> {
    let (v, p) = launch::instance_json(&app.version_id).map_err(AppError::Runtime)?;
    let dir = paths::version_dir(&app.version_id);
    let out = json!({
        "id": app.version_id,
        "inheritsFrom": v.inherits_from,
        "mainClass": v.main_class,
        "javaMajor": v.java_version.as_ref().map(|j| j.major_version).unwrap_or(17),
        "jsonPath": p.display().to_string(),
        "dir": dir.display().to_string(),
        "mods": modrinth::list_mods(&app.version_id),
    });
    ctx.log(LogLevel::Info, format!("实例目录: {}", dir.display()));
    ctx.done(out.clone(), 0);
    Ok(out)
}

// ── 安装 ───────────────────────────────────────────────────────

#[derive(App)]
#[app(
    name = "install",
    about = "下载并安装一个 Minecraft 版本（可加 --fabric）",
    run = "run_install",
    safety = "confirm"
)]
pub struct InstallCmd {
    /// 版本 id，例如 1.20.1 / 1.21.4 / 26.3
    pub version: String,
    /// 同时安装 Fabric（复用原版父版本）
    #[arg(default = false)]
    pub fabric: bool,
    /// 指定 Fabric loader 版本（默认取最新 stable）
    pub loader: Option<String>,
}

fn run_install(app: &InstallCmd, ctx: &Context) -> Result<Value, AppError> {
    let s = settings::load();
    let rep = reporter(ctx);
    let out = if app.fabric {
        block_on(fabric::install_fabric(
            &app.version,
            app.loader.as_deref(),
            s.source(),
            s.max_concurrent,
            &rep,
        ))
        .map(|(id, dir)| json!({ "versionId": id, "dir": dir.display().to_string() }))
        .map_err(AppError::Runtime)?
    } else {
        block_on(install::install_vanilla(
            &app.version,
            s.source(),
            s.max_concurrent,
            &rep,
        ))
        .map(|dir| json!({ "versionId": app.version, "dir": dir.display().to_string() }))
        .map_err(AppError::Runtime)?
    };
    ctx.log(LogLevel::Info, format!("安装完成: {out}"));
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(
    name = "remove",
    about = "删除一个实例的目录",
    run = "run_remove",
    safety = "confirm"
)]
pub struct RemoveCmd {
    /// 实例 id
    pub version_id: String,
}

fn run_remove(app: &RemoveCmd, ctx: &Context) -> Result<Value, AppError> {
    if app.version_id.contains("..") || app.version_id.contains('/') {
        return Err(AppError::InvalidArg("非法实例 id".into()));
    }
    let dir = paths::version_dir(&app.version_id);
    if !dir.is_dir() {
        return Err(AppError::Runtime(format!("实例 {} 不存在", app.version_id)));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| AppError::Runtime(format!("删除失败: {e}")))?;
    let out = json!({ "ok": true, "deleted": app.version_id });
    ctx.done(out.clone(), 0);
    Ok(out)
}

// ── 启动 ───────────────────────────────────────────────────────

#[derive(App)]
#[app(
    name = "launch",
    about = "启动一个实例（前台等待游戏退出）",
    run = "run_launch",
    safety = "confirm"
)]
pub struct LaunchCmd {
    /// 实例 id
    pub version_id: String,
    /// 账号名（离线或微软正版；默认取 settings.defaultAccount，未设则账号列表第一项，再没有用 Steve）
    pub account: Option<String>,
    /// 内存 MB（默认取设置）
    pub memory: Option<u32>,
    /// 本次启动直连的服务器地址；留空 / 省略则按设置里的默认值
    pub server: Option<String>,
    /// 只打印将执行的命令，不真的启动
    #[arg(default = false)]
    pub dry_run: bool,
}

fn run_launch(app: &LaunchCmd, ctx: &Context) -> Result<Value, AppError> {
    let global = settings::load();
    let meta = instances::load(&app.version_id).unwrap_or_default();
    let s = meta
        .effective_settings(&global)
        .map_err(AppError::Runtime)?;
    let name = app
        .account
        .clone()
        .filter(|n| !n.trim().is_empty())
        .or_else(|| settings::resolve_account_name(&s))
        .unwrap_or_else(|| "Steve".to_string());
    let acc = settings::find_account(&name).unwrap_or_else(|| settings::Account::offline(&name));
    // 正版账号启动前自动续期；命令面是同步的，这里复用同一个 block_on。
    let acc = block_on(auth::ensure_fresh(&acc)).map_err(AppError::Runtime)?;
    let opts = launch::LaunchOpts {
        id: app.version_id.clone(),
        account: mc::GameAccount::from_account(&acc),
        memory_mb: app.memory.unwrap_or(s.memory_mb),
        java_path: s.java_path.clone(),
        extra_jvm: s.extra_jvm_args.clone(),
        source: s.source(),
        concurrency: s.max_concurrent,
        game_lang: s.game_lang.clone(),
        quick_play: launch::resolve_quick_play(
            app.server.as_deref(),
            s.quick_play_server.as_deref(),
        ),
        game_dir: Some(instances::game_dir(&app.version_id, &meta)),
    };
    let rep = reporter(ctx);
    let prepared = block_on(launch::prepare(&opts, &rep)).map_err(AppError::Runtime)?;
    ctx.log(LogLevel::Info, format!("命令: {}", prepared.display_cmd()));
    if app.dry_run {
        let out = json!({
            "dryRun": true,
            "program": prepared.program,
            "args": prepared.args,
            "command": prepared.display_cmd(),
        });
        ctx.done(out.clone(), 0);
        return Ok(out);
    }
    let mut child = launch::spawn(&prepared).map_err(AppError::Runtime)?;
    let pid = child.id();
    ctx.log(
        LogLevel::Info,
        format!("已启动，pid={pid}，日志 {}", prepared.log_path.display()),
    );
    let status = child
        .wait()
        .map_err(|e| AppError::Runtime(format!("等待进程失败: {e}")))?;
    let out = json!({
        "pid": pid,
        "exitCode": status.code(),
        "logPath": prepared.log_path.display().to_string(),
        "javaVersion": prepared.java_version,
        "javaSource": prepared.java_source,
    });
    ctx.done(out.clone(), 0);
    Ok(out)
}

// ── 模组 ───────────────────────────────────────────────────────

#[derive(App)]
#[app(
    name = "mod-search",
    about = "在 Modrinth 上搜索模组",
    run = "run_mod_search"
)]
pub struct ModSearchCmd {
    /// 关键词，留空看热门
    #[arg(default = "")]
    pub query: String,
    /// 按哪个实例的 MC 版本过滤（可选）
    pub version_id: Option<String>,
}

fn game_version_of(id: &str) -> String {
    if let Ok((v, _)) = launch::instance_json(id) {
        if let Some(base) = v.inherits_from {
            return base;
        }
        return v.id;
    }
    id.to_string()
}

fn run_mod_search(app: &ModSearchCmd, ctx: &Context) -> Result<Value, AppError> {
    let gv = app.version_id.as_deref().map(game_version_of);
    let r = block_on(modrinth::search(&app.query, gv.as_deref(), Some("fabric")))
        .map_err(AppError::Runtime)?;
    for h in r.hits.iter().take(20) {
        ctx.log(
            LogLevel::Info,
            format!("{:<40} {} 下载 {}", h.title, h.slug, h.downloads),
        );
    }
    let out = json!({ "hits": r.hits, "total": r.total_hits });
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(
    name = "mod-add",
    about = "把 Modrinth 上的一个模组装进实例",
    run = "run_mod_add",
    safety = "confirm"
)]
pub struct ModAddCmd {
    /// 实例 id
    pub version_id: String,
    /// Modrinth 项目 id 或 slug
    pub project: String,
}

fn run_mod_add(app: &ModAddCmd, ctx: &Context) -> Result<Value, AppError> {
    let gv = game_version_of(&app.version_id);
    let rep = reporter(ctx);
    let p = block_on(modrinth::install_mod(
        &app.version_id,
        &app.project,
        &gv,
        "fabric",
        &rep,
    ))
    .map_err(AppError::Runtime)?;
    let out = json!({ "file": p.display().to_string() });
    ctx.log(LogLevel::Info, format!("已安装: {}", p.display()));
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(
    name = "mod-remove",
    about = "从实例里删掉一个模组文件",
    run = "run_mod_remove",
    safety = "confirm"
)]
pub struct ModRemoveCmd {
    /// 实例 id
    pub version_id: String,
    /// mods 目录里的文件名
    pub file: String,
}

fn run_mod_remove(app: &ModRemoveCmd, ctx: &Context) -> Result<Value, AppError> {
    modrinth::remove_mod(&app.version_id, &app.file).map_err(AppError::Runtime)?;
    let out = json!({ "ok": true });
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(name = "mods", about = "列出实例已装的模组", run = "run_mods")]
pub struct ModsCmd {
    /// 实例 id
    pub version_id: String,
}

fn run_mods(app: &ModsCmd, ctx: &Context) -> Result<Value, AppError> {
    let list = modrinth::list_mods(&app.version_id);
    for m in &list {
        ctx.log(
            LogLevel::Info,
            format!(
                "{}  ({:.1} MB)",
                m["file"].as_str().unwrap_or("-"),
                m["size"].as_u64().unwrap_or(0) as f64 / 1_048_576.0
            ),
        );
    }
    let out = json!({ "versionId": app.version_id, "mods": list });
    ctx.done(out.clone(), 0);
    Ok(out)
}

// ── Java / 设置 ────────────────────────────────────────────────

#[derive(App)]
#[app(name = "javas", about = "列出系统里可用的 Java", run = "run_javas")]
pub struct JavasCmd {}

fn run_javas(_app: &JavasCmd, ctx: &Context) -> Result<Value, AppError> {
    let list = java::scan_system();
    for j in &list {
        ctx.log(LogLevel::Info, format!("java {}  {}", j.version, j.path));
    }
    let out = json!({ "javas": list });
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(name = "settings", about = "查看当前配置", run = "run_settings")]
pub struct SettingsShowCmd {}

fn run_settings(_app: &SettingsShowCmd, ctx: &Context) -> Result<Value, AppError> {
    let s = settings::load();
    let out = serde_json::to_value(&s).unwrap_or_else(|_| json!({}));
    ctx.log(
        LogLevel::Info,
        format!("配置文件: {}", paths::settings_file().display()),
    );
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(
    name = "settings-set",
    about = "修改配置（只改动传入的字段）",
    run = "run_settings_set",
    safety = "confirm"
)]
pub struct SettingsSetCmd {
    /// 分给游戏的内存 MB
    pub memory: Option<u32>,
    /// 指定 java 可执行文件（填 none 恢复自动探测）
    pub java_path: Option<String>,
    /// 下载源：mojang | bmcl
    pub source: Option<String>,
    /// 同时下载文件数
    pub concurrency: Option<usize>,
    /// 追加 JVM 参数，空格分隔
    pub extra_jvm: Option<String>,
    /// 默认账号（填 none 清除，回退账号列表第一项）
    pub default_account: Option<String>,
}

fn run_settings_set(app: &SettingsSetCmd, ctx: &Context) -> Result<Value, AppError> {
    let mut s = settings::load();
    if let Some(m) = app.memory {
        s.memory_mb = m;
    }
    if let Some(p) = app.java_path.as_ref() {
        let t = p.trim();
        s.java_path = if t.is_empty() || t == "none" {
            None
        } else {
            Some(t.to_string())
        };
    }
    if let Some(src) = app.source.as_ref() {
        s.download_source = src.trim().to_string();
    }
    if let Some(c) = app.concurrency {
        s.max_concurrent = c;
    }
    if let Some(j) = app.extra_jvm.as_ref() {
        s.extra_jvm_args = j.split_whitespace().map(|x| x.to_string()).collect();
    }
    if let Some(d) = app.default_account.as_ref() {
        let t = d.trim();
        s.default_account = if t.is_empty() || t == "none" {
            None
        } else {
            Some(t.to_string())
        };
    }
    let saved = settings::save(&s).map_err(AppError::Runtime)?;
    let out = serde_json::to_value(&saved).unwrap_or_else(|_| json!({}));
    ctx.log(LogLevel::Info, "配置已保存");
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(
    name = "accounts",
    about = "列出账号（离线 / 微软正版）",
    run = "run_accounts"
)]
pub struct AccountsCmd {}

fn run_accounts(_app: &AccountsCmd, ctx: &Context) -> Result<Value, AppError> {
    let list = settings::load_accounts();
    for a in &list {
        ctx.log(LogLevel::Info, format!("{:<20} {}", a.name, a.uuid));
    }
    let out = json!({ "accounts": list });
    ctx.done(out.clone(), 0);
    Ok(out)
}

#[derive(App)]
#[app(
    name = "account-add",
    about = "新增一个离线账号",
    run = "run_account_add",
    safety = "confirm"
)]
pub struct AccountAddCmd {
    /// 用户名（3-16 位字母数字下划线）
    pub name: String,
}

fn run_account_add(app: &AccountAddCmd, ctx: &Context) -> Result<Value, AppError> {
    let acc = settings::add_account(&app.name).map_err(AppError::Runtime)?;
    let out = json!({ "account": acc });
    ctx.log(LogLevel::Info, format!("账号 {} 已添加", acc.name));
    ctx.done(out.clone(), 0);
    Ok(out)
}

// ── 注册表 ─────────────────────────────────────────────────────

/// 组装命令面（CLI / TUI / MCP / Web 命令清单共用）
pub fn registry() -> Registry {
    registry_with_policy(Arc::new(lilyco::prelude::DenyElevated))
}

/// 用指定安全策略**从头**装配注册表。
///
/// 必须如此：lilyco 的安全门在 `Registry::register` 时就把策略包进了 handler，
/// 事后换策略只会把新门套在旧门外面，旧门仍然拒绝。所以策略必须先于注册就位。
pub fn registry_with_policy(policy: Arc<dyn SafetyPolicy>) -> Registry {
    let mut reg = Registry::new().with_policy(policy);
    let cmds: Vec<RegisteredCommand> = vec![
        RegisteredCommand::from_app::<ListCmd>(),
        RegisteredCommand::from_app::<InfoCmd>(),
        RegisteredCommand::from_app::<InstallCmd>(),
        RegisteredCommand::from_app::<RemoveCmd>(),
        RegisteredCommand::from_app::<LaunchCmd>(),
        RegisteredCommand::from_app::<ModSearchCmd>(),
        RegisteredCommand::from_app::<ModAddCmd>(),
        RegisteredCommand::from_app::<ModRemoveCmd>(),
        RegisteredCommand::from_app::<ModsCmd>(),
        RegisteredCommand::from_app::<JavasCmd>(),
        RegisteredCommand::from_app::<SettingsShowCmd>(),
        RegisteredCommand::from_app::<SettingsSetCmd>(),
        RegisteredCommand::from_app::<AccountsCmd>(),
        RegisteredCommand::from_app::<AccountAddCmd>(),
    ];
    for c in cmds {
        if let Err(e) = reg.register(c) {
            eprintln!("lycomc: 注册命令失败: {e}");
        }
    }
    reg
}

#[cfg(test)]
mod tests {
    use super::*;

    // CLI --help 与 --schema 是对外可观测契约；上游 Registry 用 BTreeMap 固定名字顺序后，
    // 启动器自己的命令组合也不能退化成随机顺序，否则跨进程对比会假失败。
    #[test]
    fn registry_command_names_are_deterministic() {
        let reg = registry_with_policy(Arc::new(lilyco::prelude::DenyElevated));
        let names = reg.names();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted, "命令清单应按名字有序输出");
        assert_eq!(names.len(), 14, "lycomc 目前注册 14 条命令");
        assert_eq!(names.first().map(String::as_str), Some("account-add"));
        assert_eq!(names.last().map(String::as_str), Some("settings-set"));
        let json = serde_json::to_string(&reg.to_json()).expect("schema 可序列化");
        let reg2 = registry_with_policy(Arc::new(lilyco::prelude::DenyElevated));
        assert_eq!(json, serde_json::to_string(&reg2.to_json()).unwrap());
    }
}
