//! HTTP 控制台：给 Web UI 用的 REST + SSE 接口。
//!
//! 这是四个前端里的「浏览器」那一端，其他三个（CLI / TUI / MCP）走 lilyco 命令面。
//! 后端只暴露三样东西：MC 内核、任务表、内嵌的前端产物。

use std::collections::HashMap;
use std::path::{Path as StdPath, PathBuf};
use std::sync::{Arc, RwLock};

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::backup;
use crate::jobs::{now_ms, Job, JobStore};
use crate::mc::{
    self, auth, fabric, install, instances, java, launch, localize, meta, modrinth, options, paths,
    Progress,
};
use crate::settings::{self, Account, Settings};

// ── 错误形态 ───────────────────────────────────────────────────

/// 统一错误体：{"error": "..."} —— 前端只认这个字段
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }
    fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: msg.into(),
        }
    }
    fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: msg.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

// ── 运行中的游戏进程 ───────────────────────────────────────────

#[derive(Clone)]
pub struct Running {
    pub version_id: String,
    pub account: String,
    pub started_at: u64,
    pub log_path: PathBuf,
}

// ── 共享状态 ───────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    settings: Arc<RwLock<Settings>>,
    pub jobs: JobStore,
    pub running: Arc<RwLock<HashMap<u32, Running>>>,
    /// 远程版本清单缓存，避免每次开页面都打 mojang
    remote: Arc<RwLock<Option<Value>>>,
    /// 最近的启动命令（前端展示「将执行什么」）
    last_cmd: Arc<RwLock<Option<String>>>,
}

impl AppState {
    pub fn new(s: Settings) -> Self {
        Self {
            settings: Arc::new(RwLock::new(s)),
            jobs: JobStore::new(),
            running: Arc::new(RwLock::new(HashMap::new())),
            remote: Arc::new(RwLock::new(None)),
            last_cmd: Arc::new(RwLock::new(None)),
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().map(|g| g.clone()).unwrap_or_default()
    }

    fn set_settings(&self, s: Settings) {
        if let Ok(mut w) = self.settings.write() {
            *w = s;
        }
    }

    /// 给异步任务用的进度回调（Arc 版，可以 move 进 tokio::spawn）
    fn sink(&self, job_id: &str) -> Arc<dyn Fn(Progress) + Send + Sync> {
        Arc::new(self.jobs.sink(job_id))
    }
}

// ── 路由 ───────────────────────────────────────────────────────

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/state", get(state_all))
        .route("/api/remote/versions", get(remote_versions))
        .route("/api/versions/install", post(install_version))
        .route(
            "/api/versions/{id}",
            get(get_version).patch(patch_version).delete(delete_version),
        )
        .route(
            "/api/versions/{id}/settings",
            get(get_version_settings)
                .put(put_version_settings)
                .delete(delete_version_settings),
        )
        .route("/api/launch", post(do_launch))
        .route("/api/launch/{pid}/kill", post(kill_launch))
        .route("/api/jobs/{id}", get(get_job))
        .route("/api/jobs", get(list_jobs))
        .route("/api/events", get(events))
        .route("/api/accounts", get(list_accounts).post(add_account))
        .route("/api/accounts/{name}", delete(del_account))
        .route("/api/accounts/{name}/skin", get(account_skin))
        .route("/api/accounts/{name}/default", post(set_default_account))
        .route("/api/auth/microsoft/start", post(ms_start))
        .route("/api/auth/microsoft/poll", post(ms_poll))
        .route("/api/auth/microsoft/refresh", post(ms_refresh))
        .route("/api/auth/microsoft/logout", post(ms_logout))
        .route("/api/skin/image", get(skin_image))
        .route("/api/modrinth/search", get(mod_search))
        .route("/api/mods", get(list_mods))
        .route("/api/mods/toggle", post(mod_toggle))
        .route("/api/mods/info", get(mod_info_handler))
        .route("/api/mods/install", post(mod_install))
        .route("/api/mods/remove", post(mod_remove))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/settings/export", get(export_settings))
        .route("/api/settings/import", post(import_settings))
        .route("/api/backup/create", post(create_backup))
        .route("/api/backup/list", get(list_backups))
        .route("/api/backup/{id}/restore", post(restore_backup))
        .route("/api/cleanup", post(cleanup_cache))
        .route("/api/localize", post(localize_version))
        .route("/api/logs/{versionId}", get(get_logs))
        .with_state(state)
        .fallback(static_file)
}

// ── 元信息 ─────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({
        "name": "lycomc",
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "webMode": if crate::assets::embedded() { "embedded" } else { "missing" },
        "dataDir": paths::data_dir().display().to_string(),
    }))
}

/// 实例摘要：从落盘的 version json 反推，不猜
fn version_info(id: &str) -> Option<Value> {
    let (v, p) = launch::instance_json(id).ok()?;
    let mtime = std::fs::metadata(&p).ok().and_then(|m| m.modified().ok());
    let installed_at = mtime
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let base = v.inherits_from.clone();
    let kind = if base.is_some() { "fabric" } else { "vanilla" };
    let (lang, packs, localized) = options::status(id);
    Some(json!({
        "id": id,
        "kind": kind,
        "baseVersion": base.unwrap_or_else(|| id.to_string()),
        "installedAt": installed_at,
        "javaMajor": v.java_version.as_ref().map(|j| j.major_version).unwrap_or(17),
        "mainClass": v.main_class.clone().unwrap_or_default(),
        "lang": lang,
        "resourcePacks": packs,
        "localized": localized,
    }))
    .map(|mut v| {
        if let Some(obj) = v.as_object_mut() {
            for (k, val) in instances::version_fields(id)
                .as_object()
                .cloned()
                .unwrap_or_default()
            {
                obj.insert(k, val);
            }
        }
        v
    })
}

fn installed_versions() -> Vec<Value> {
    install::installed_ids()
        .iter()
        .filter_map(|id| version_info(id))
        .collect()
}

fn running_list(st: &AppState) -> Vec<Value> {
    let g = match st.running.read() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    let mut v: Vec<Value> = g
        .iter()
        .map(|(pid, r)| {
            json!({
                "pid": pid,
                "versionId": r.version_id,
                // 前端契约用 accountName；account 是老名字，一起给免得两边对不上
                "accountName": r.account,
                "account": r.account,
                "startedAt": r.started_at,
                "logPath": r.log_path.display().to_string(),
            })
        })
        .collect();
    v.sort_by(|a, b| b["startedAt"].as_u64().cmp(&a["startedAt"].as_u64()));
    v
}

async fn state_all(State(st): State<AppState>) -> Json<Value> {
    // Java 探测会启动外部进程、读多个安装目录；放到 blocking 线程池，
    // 即使某个候选卡住也不会占住 axum 的 async worker。
    let settings = st.settings();
    let remote = st.remote.read().ok().and_then(|g| g.clone());
    let last_cmd = st.last_cmd.read().ok().and_then(|g| g.clone());
    let running = running_list(&st);
    let jobs = st.jobs.list();
    let data_dir = paths::data_dir().display().to_string();
    let disk = tokio::task::spawn_blocking(|| {
        let javas: Vec<Value> = java::scan_system()
            .into_iter()
            .map(|j| json!({ "path": j.path, "version": j.version, "source": j.source }))
            .collect();
        (settings::load_accounts(), installed_versions(), javas)
    })
    .await
    .unwrap_or_else(|_| (Vec::new(), Vec::new(), Vec::new()));
    Json(json!({
        "settings": settings,
        "accounts": disk.0,
        "versions": disk.1,
        "running": running,
        "javas": disk.2,
        "remote": remote,
        "jobs": jobs,
        "lastCommand": last_cmd,
        "dataDir": data_dir,
    }))
}

// ── 远程版本 ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct RefreshQ {
    #[serde(default)]
    refresh: Option<String>,
}

async fn remote_versions(
    State(st): State<AppState>,
    Query(q): Query<RefreshQ>,
) -> Result<Json<Value>, ApiError> {
    let force = q.refresh.as_deref() == Some("1") || q.refresh.as_deref() == Some("true");
    if !force {
        if let Ok(g) = st.remote.read() {
            if let Some(v) = g.as_ref() {
                return Ok(Json(v.clone()));
            }
        }
    }
    let s = st.settings();
    let m = meta::manifest(s.source(), force)
        .await
        .map_err(ApiError::internal)?;
    let versions: Vec<Value> = m
        .versions
        .iter()
        .map(|v| {
            json!({
                "id": v.id,
                "type": v.kind,
                "releaseTime": v.release_time,
                "installed": install::is_installed(&v.id),
            })
        })
        .collect();
    let out = json!({
        "latest": { "release": m.latest.release, "snapshot": m.latest.snapshot },
        "versions": versions,
    });
    if let Ok(mut w) = st.remote.write() {
        *w = Some(out.clone());
    }
    Ok(Json(out))
}

// ── 安装 / 删除 ────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallReq {
    version_id: String,
    #[serde(default)]
    fabric: Option<bool>,
    /// fabric 可选指定 loader 版本
    #[serde(default)]
    loader: Option<String>,
}

async fn install_version(
    State(st): State<AppState>,
    Json(req): Json<InstallReq>,
) -> Result<Json<Value>, ApiError> {
    let id = req.version_id.trim().to_string();
    if id.is_empty() {
        return Err(ApiError::bad("缺少 versionId"));
    }
    if id.contains('/') || id.contains("..") {
        return Err(ApiError::bad("非法版本 id"));
    }
    let s = st.settings();
    let fabric_want = req.fabric.unwrap_or(false);
    let loader = req.loader.clone();
    let title = if fabric_want {
        format!("安装 Fabric {id}")
    } else {
        format!("安装 {id}")
    };
    let job = st.jobs.create("install", title);
    let st2 = st.clone();
    let job2 = job.clone();
    tokio::spawn(async move {
        let sink = st2.sink(&job2);
        let r = if fabric_want {
            fabric::install_fabric(&id, loader.as_deref(), s.source(), s.max_concurrent, &*sink)
                .await
                .map(|(iid, _)| json!({ "versionId": iid }))
        } else {
            install::install_vanilla(&id, s.source(), s.max_concurrent, &*sink)
                .await
                .map(|_| json!({ "versionId": id }))
        };
        match r {
            Ok(v) => st2.jobs.done(&job2, v),
            Err(e) => st2.jobs.fail(&job2, e),
        }
    });
    Ok(Json(json!({ "jobId": job })))
}

// ── 一键汉化 ───────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalizeReq {
    version_id: String,
}

async fn localize_version(
    State(st): State<AppState>,
    Json(req): Json<LocalizeReq>,
) -> Result<Json<Value>, ApiError> {
    let id = req.version_id.trim().to_string();
    if id.is_empty() {
        return Err(ApiError::bad("缺少 versionId"));
    }
    if id.contains('/') || id.contains("..") {
        return Err(ApiError::bad("非法版本 id"));
    }
    if !install::is_installed(&id) {
        return Err(ApiError::bad(format!("版本 {id} 尚未安装")));
    }
    let s = st.settings();
    let lang = s.game_lang.clone();
    let source = s.source();
    let job = st.jobs.create("localize", format!("汉化 {id}"));
    let st2 = st.clone();
    let job2 = job.clone();
    tokio::spawn(async move {
        let sink = st2.sink(&job2);
        match localize::run(&id, &lang, source, &*sink).await {
            Ok(v) => st2.jobs.done(&job2, v),
            Err(e) => st2.jobs.fail(&job2, e),
        }
    });
    Ok(Json(json!({ "jobId": job })))
}

async fn delete_version(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if id.contains('/') || id.contains("..") {
        return Err(ApiError::bad("非法版本 id"));
    }
    let dir = paths::version_dir(&id);
    if !dir.is_dir() {
        return Err(ApiError::not_found(format!("版本 {id} 不存在")));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| ApiError::internal(format!("删除失败: {e}")))?;
    let _ = st;
    Ok(Json(json!({ "ok": true })))
}

// ── 启动 ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchReq {
    version_id: String,
    account_name: Option<String>,
    memory_mb: Option<u32>,
    /// 本次启动直连地址；字段存在（含空串 / null）就覆盖设置默认值，缺省才回落。
    #[serde(default, deserialize_with = "double_option")]
    server: Option<Option<String>>,
}

/// POST /api/launch 的 server 覆盖语义：present 优先，missing 才用设置默认值。
fn resolve_quick_play(req: &LaunchReq, s: &Settings) -> Option<launch::QuickPlay> {
    match &req.server {
        Some(override_server) => launch::resolve_quick_play(override_server.as_deref(), None),
        None => launch::resolve_quick_play(None, s.quick_play_server.as_deref()),
    }
}

async fn do_launch(
    State(st): State<AppState>,
    Json(req): Json<LaunchReq>,
) -> Result<Json<Value>, ApiError> {
    let id = req.version_id.trim().to_string();
    if id.is_empty() {
        return Err(ApiError::bad("缺少 versionId"));
    }
    if !install::is_installed(&id) {
        return Err(ApiError::bad(format!("版本 {id} 尚未安装")));
    }
    let global = st.settings();
    let id_for_instance = id.clone();
    let instance = instances::load(&id_for_instance).unwrap_or_default();
    let s = instance
        .effective_settings(&global)
        .map_err(ApiError::bad)?;
    let name = req
        .account_name
        .clone()
        .filter(|n| !n.trim().is_empty())
        .or_else(|| settings::resolve_account_name(&s))
        .unwrap_or_else(|| "Steve".to_string());
    let acc = settings::find_account(&name).unwrap_or_else(|| Account::offline(&name));
    // 正版账号启动前自动续期；过期且刷新失败就明确报错，不再静默拿旧 token 启动。
    let acc = auth::ensure_fresh(&acc).await.map_err(ApiError::bad)?;
    let memory = req.memory_mb.unwrap_or(s.memory_mb).clamp(512, 65536);
    let opts = launch::LaunchOpts {
        id: id.clone(),
        account: mc::GameAccount::from_account(&acc),
        memory_mb: memory,
        java_path: s.java_path.clone(),
        extra_jvm: s.extra_jvm_args.clone(),
        source: s.source(),
        concurrency: s.max_concurrent,
        game_lang: s.game_lang.clone(),
        quick_play: resolve_quick_play(&req, &s),
        game_dir: Some(instances::game_dir(&id_for_instance, &instance)),
    };
    let job = st.jobs.create("launch", format!("启动 {id}"));
    let st2 = st.clone();
    let job2 = job.clone();
    let version_id = id.clone();
    tokio::spawn(async move {
        let sink = st2.sink(&job2);
        let prepared = match launch::prepare(&opts, &*sink).await {
            Ok(p) => p,
            Err(e) => {
                st2.jobs.fail(&job2, e);
                return;
            }
        };
        if let Ok(mut w) = st2.last_cmd.write() {
            *w = Some(prepared.display_cmd());
        }
        st2.jobs
            .log(&job2, format!("命令: {}", prepared.display_cmd()));
        match launch::spawn(&prepared) {
            Ok(child) => {
                let pid = child.id();
                if let Ok(mut w) = st2.running.write() {
                    w.insert(
                        pid,
                        Running {
                            version_id: version_id.clone(),
                            account: opts.account.name.clone(),
                            started_at: now_ms(),
                            log_path: prepared.log_path.clone(),
                        },
                    );
                }
                let log_path = prepared.log_path.clone();
                st2.jobs.done(
                    &job2,
                    json!({ "pid": pid, "logPath": log_path.display().to_string() }),
                );
                // 收尸：进程退出后从运行表里摘掉，顺便记一行退出码
                tokio::task::spawn_blocking(move || {
                    let mut child = child;
                    let code = child.wait().ok().and_then(|s| s.code());
                    // 运行表在 st3 里，spawn_blocking 里不能用 st2（已 move），故用全局注册表
                    crate::api::reap(pid, code);
                });
            }
            Err(e) => st2.jobs.fail(&job2, e),
        }
    });
    Ok(Json(json!({ "jobId": job })))
}

/// 进程退出后清理运行表（spawn_blocking 里没法带 AppState，走这张全局表）
static GLOBAL_RUNNING: std::sync::OnceLock<Arc<RwLock<HashMap<u32, Running>>>> =
    std::sync::OnceLock::new();

pub fn set_global_running(r: Arc<RwLock<HashMap<u32, Running>>>) {
    let _ = GLOBAL_RUNNING.set(r);
}

pub fn reap(pid: u32, code: Option<i32>) {
    if let Some(r) = GLOBAL_RUNNING.get() {
        let log_path = r
            .read()
            .ok()
            .and_then(|g| g.get(&pid).map(|x| x.log_path.clone()));
        if let Ok(mut w) = r.write() {
            w.remove(&pid);
        }
        if let Some(p) = log_path {
            let line = match code {
                Some(c) => format!("[lycomc] 游戏进程 {pid} 已退出，退出码 {c}"),
                None => format!("[lycomc] 游戏进程 {pid} 已退出（被信号终止）"),
            };
            let mut opts = std::fs::OpenOptions::new();
            opts.create(true).append(true);
            if let Ok(mut f) = opts.open(&p) {
                use std::io::Write;
                let _ = writeln!(f, "{line}");
            }
            println!("{line}");
        }
    }
}

// ── 按 PID 结束游戏进程（跨平台） ──────────────────────────────
//
// Windows 的 libc 没有 kill / SIGTERM / SIGKILL；按平台分流：Unix 用 POSIX
// 信号，Windows 用系统自带 taskkill.exe，其他平台显式报错。保持「先请求
// 正常退出、3 秒后仍在则强制结束」的两段式语义。

#[cfg(unix)]
fn signal_game(pid: u32, sig: libc::c_int) -> Result<(), String> {
    // pid_t 有符号；拒绝越界 / 非正值，避免 kill(-1, ...) 误伤整个进程组。
    let target =
        <libc::pid_t>::try_from(pid).map_err(|_| format!("游戏进程 pid {pid} 超出 pid_t 范围"))?;
    if target <= 0 {
        return Err(format!("游戏进程 pid {pid} 无效"));
    }
    // SAFETY: kill 只向指定 pid 发信号，不读写用户内存；target 已校验为正数。
    let rc = unsafe { libc::kill(target, sig) };
    if rc == 0 {
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    // 进程已退出并被 reap，与「结束成功」等价，不向前端报错。
    if err.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(format!("向游戏进程 {pid} 发送信号 {sig} 失败: {err}"))
}

#[cfg(unix)]
fn request_game_exit(pid: u32) -> Result<(), String> {
    signal_game(pid, libc::SIGTERM)
}

#[cfg(unix)]
fn force_game_exit(pid: u32) -> Result<(), String> {
    signal_game(pid, libc::SIGKILL)
}

#[cfg(windows)]
fn request_game_exit(pid: u32) -> Result<(), String> {
    taskkill_game(pid, false)
}

#[cfg(windows)]
fn force_game_exit(pid: u32) -> Result<(), String> {
    taskkill_game(pid, true)
}

#[cfg(windows)]
fn taskkill_game(pid: u32, force: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    // 优先用绝对路径，避免 PATH 里出现同名程序；SystemRoot 缺失时回退到 PATH。
    let program = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|p| p.join("System32").join("taskkill.exe"))
        .unwrap_or_else(|| PathBuf::from("taskkill.exe"));
    // 0x08000000 = CREATE_NO_WINDOW，避免结束游戏时闪出控制台窗口。
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new(&program);
    cmd.arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    if force {
        cmd.arg("/F");
    }
    // 不 wait：drop Child 在 Windows 不会杀掉它，taskkill 由 OS 自行回收。
    match cmd.spawn() {
        Ok(_child) => Ok(()),
        Err(e) => Err(format!("启动 {} 失败: {e}", program.display())),
    }
}

#[cfg(not(any(unix, windows)))]
fn request_game_exit(_pid: u32) -> Result<(), String> {
    Err("当前平台不支持按 PID 结束游戏进程".to_string())
}

#[cfg(not(any(unix, windows)))]
fn force_game_exit(_pid: u32) -> Result<(), String> {
    Err("当前平台不支持按 PID 结束游戏进程".to_string())
}

async fn kill_launch(
    State(st): State<AppState>,
    Path(pid): Path<u32>,
) -> Result<Json<Value>, ApiError> {
    let known = st
        .running
        .read()
        .map(|g| g.contains_key(&pid))
        .unwrap_or(false);
    if !known {
        return Err(ApiError::not_found(format!("没有 pid {pid} 的游戏进程")));
    }
    // 先请求游戏正常退出（Unix SIGTERM / Windows taskkill /T），给它 3 秒存档。
    request_game_exit(pid).map_err(ApiError::internal)?;
    let st2 = st.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let still = st2
            .running
            .read()
            .map(|g| g.contains_key(&pid))
            .unwrap_or(false);
        if still {
            if let Err(e) = force_game_exit(pid) {
                eprintln!("[lycomc] 强制结束游戏进程 {pid} 失败: {e}");
            }
        }
    });
    Ok(Json(json!({ "ok": true })))
}

// ── 任务 / 事件 ────────────────────────────────────────────────

async fn get_job(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Job>, ApiError> {
    st.jobs
        .get(&id)
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("任务不存在: {id}")))
}

async fn list_jobs(State(st): State<AppState>) -> Json<Value> {
    Json(json!({ "jobs": st.jobs.list() }))
}

/// 全局事件流：所有任务的变化都推出来，前端按 id 过滤。
/// 事件名按状态分 progress / done / error，SSE 客户端可以直接 addEventListener。
async fn events(
    State(st): State<AppState>,
) -> Sse<impl futures_util::Stream<Item = Result<SseEvent, std::convert::Infallible>>> {
    let rx = st.jobs.subscribe();
    let initial = st.jobs.list();
    let stream = async_stream_next(initial, rx);
    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn async_stream_next(
    initial: Vec<Job>,
    mut rx: broadcast::Receiver<Job>,
) -> impl futures_util::Stream<Item = Result<SseEvent, std::convert::Infallible>> {
    async_stream::stream! {
        for j in initial {
            yield Ok(sse_event(&j));
        }
        loop {
            match rx.recv().await {
                Ok(job) => yield Ok(sse_event(&job)),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
}

fn sse_event(job: &Job) -> SseEvent {
    let name = match job.state {
        crate::jobs::State::Running => "progress",
        crate::jobs::State::Done => "done",
        crate::jobs::State::Error => "error",
    };
    SseEvent::default()
        .event(name)
        .data(serde_json::to_string(job).unwrap_or_else(|_| "{}".into()))
}

// ── 账号 ───────────────────────────────────────────────────────

async fn list_accounts() -> Json<Value> {
    Json(json!({ "accounts": settings::load_accounts() }))
}

#[derive(Deserialize)]
struct AccountReq {
    name: String,
}

async fn add_account(Json(req): Json<AccountReq>) -> Result<Json<Account>, ApiError> {
    settings::add_account(&req.name)
        .map(Json)
        .map_err(ApiError::bad)
}

async fn del_account(
    State(st): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    settings::remove_account(&name).map_err(ApiError::bad)?;
    // 删掉的若是默认账号，remove_account 已清理 settings.json，这里同步内存快照。
    st.set_settings(settings::load());
    Ok(Json(json!({ "ok": true })))
}

/// 把某个已存在的账号设为默认账号（下次启动不指定账号时用它）。
async fn set_default_account(
    State(st): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Settings>, ApiError> {
    let saved = settings::set_default_account(&name).map_err(ApiError::bad)?;
    st.set_settings(saved.clone());
    Ok(Json(saved))
}
// ── 微软正版登录 / 皮肤 ──────────────────────────────────────

/// 开始设备码登录。设备码本身只留在内存，不下发 cookie 也不落盘。
async fn ms_start() -> Result<Json<Value>, ApiError> {
    auth::start().await.map(Json).map_err(ApiError::internal)
}

/// 单次轮询；前端按 interval 秒重复调用，避免后台长期占用一个任务。
async fn ms_poll() -> Result<Json<Value>, ApiError> {
    auth::poll().await.map(Json).map_err(ApiError::internal)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NameReq {
    name: String,
}

async fn ms_refresh(Json(req): Json<NameReq>) -> Result<Json<Value>, ApiError> {
    auth::refresh(&req.name)
        .await
        .map(|a| Json(json!({ "account": a })))
        .map_err(ApiError::bad)
}

async fn ms_logout(Json(req): Json<NameReq>) -> Result<Json<Value>, ApiError> {
    settings::clear_session(&req.name).map_err(ApiError::bad)?;
    Ok(Json(json!({ "ok": true })))
}

async fn account_skin(Path(name): Path<String>) -> Result<Json<Value>, ApiError> {
    auth::skin_for(&name)
        .await
        .map(Json)
        .map_err(ApiError::internal)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SkinImageQ {
    url: Option<String>,
    model: Option<String>,
}

/// 同源图片代理：官方纹理失效（实测旧纹理 404）时回退内置 Steve/Alex PNG。
async fn skin_image(Query(q): Query<SkinImageQ>) -> Response {
    let body = auth::skin_image(q.url, q.model).await;
    let mut resp = (StatusCode::OK, body).into_response();
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );
    resp
}

// ── 模组 ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModSearchQ {
    #[serde(default)]
    q: Option<String>,
    #[serde(default, alias = "version_id")]
    version_id: Option<String>,
}

/// 实例是不是 fabric：决定 Modrinth 的 loader 过滤条件
fn loader_of(id: &str) -> &'static str {
    match launch::instance_json(id) {
        Ok((v, _)) if v.inherits_from.is_some() => "fabric",
        _ => "fabric",
    }
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

async fn mod_search(
    State(st): State<AppState>,
    Query(q): Query<ModSearchQ>,
) -> Result<Json<Value>, ApiError> {
    let _ = &st;
    let query = q.q.unwrap_or_default();
    let vid = q.version_id.filter(|v| !v.trim().is_empty());
    let gv = vid.as_deref().map(game_version_of);
    let loader = vid.as_deref().map(loader_of);
    let r = modrinth::search(&query, gv.as_deref(), loader)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "hits": r.hits, "total": r.total_hits })))
}

async fn list_mods(State(st): State<AppState>, Query(q): Query<ModSearchQ>) -> Json<Value> {
    let _ = &st;
    let id = q.version_id.unwrap_or_default();
    if id.is_empty() {
        return Json(json!({ "mods": [] }));
    }
    Json(json!({ "mods": modrinth::list_mods(&id) }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModToggleReq {
    #[serde(alias = "version_id")]
    version_id: String,
    file: String,
    enabled: bool,
}

async fn mod_toggle(
    State(_st): State<AppState>,
    Json(req): Json<ModToggleReq>,
) -> Result<Json<Value>, ApiError> {
    if !instances::valid_id(&req.version_id) {
        return Err(ApiError::bad("非法实例 ID"));
    }
    modrinth::toggle_mod(&req.version_id, &req.file, req.enabled)
        .map(Json)
        .map_err(ApiError::bad)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModInfoQ {
    #[serde(alias = "version_id")]
    version_id: String,
    file: String,
}

async fn mod_info_handler(Query(q): Query<ModInfoQ>) -> Result<Json<Value>, ApiError> {
    if !instances::valid_id(&q.version_id) {
        return Err(ApiError::bad("非法实例 ID"));
    }
    modrinth::mod_info(&q.version_id, &q.file)
        .map(Json)
        .map_err(ApiError::bad)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModInstallReq {
    version_id: String,
    project_id: String,
}

async fn mod_install(
    State(st): State<AppState>,
    Json(req): Json<ModInstallReq>,
) -> Result<Json<Value>, ApiError> {
    if !install::is_installed(&req.version_id) {
        return Err(ApiError::bad(format!("版本 {} 尚未安装", req.version_id)));
    }
    let gv = game_version_of(&req.version_id);
    let loader = loader_of(&req.version_id).to_string();
    let job = st
        .jobs
        .create("mods", format!("安装模组 {}", req.project_id));
    let st2 = st.clone();
    let job2 = job.clone();
    let vid = req.version_id.clone();
    let pid = req.project_id.clone();
    tokio::spawn(async move {
        let sink = st2.sink(&job2);
        match modrinth::install_mod(&vid, &pid, &gv, &loader, &*sink).await {
            Ok(p) => st2
                .jobs
                .done(&job2, json!({ "file": p.display().to_string() })),
            Err(e) => st2.jobs.fail(&job2, e),
        }
    });
    Ok(Json(json!({ "jobId": job })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModRemoveReq {
    #[serde(alias = "version_id")]
    version_id: String,
    file: String,
}

async fn mod_remove(
    State(st): State<AppState>,
    Json(req): Json<ModRemoveReq>,
) -> Result<Json<Value>, ApiError> {
    let _ = st;
    modrinth::remove_mod(&req.version_id, &req.file).map_err(ApiError::bad)?;
    Ok(Json(json!({ "ok": true })))
}

// ── 设置 / 日志 ────────────────────────────────────────────────

async fn get_settings(State(st): State<AppState>) -> Json<Settings> {
    Json(st.settings())
}

/// 设置的部分更新载荷。
///
/// 前端只提交「改动过的字段」（Partial<Settings>），所以这里每个字段都必须是
/// Option：缺省 = 保持原值。若直接用 Json<Settings>，serde 的 #[serde(default)]
/// 会把没传的字段一律拉回默认值——用户改一下内存就会把 selectVersion 清空、
/// 在版本页切实例又会把内存从 6G 打回 4G。
///
/// 注意：可空字段不能只声明成 Option<Option<T>>。serde 会把「显式 JSON null」
/// 与「字段缺失」都解成外层 None，导致 PUT {javaPath:null} 被当成不更新。
/// 这里用 double_option 把 present null 解成 Some(None)，missing 仍是 None。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SettingsPatch {
    memory_mb: Option<u32>,
    #[serde(default, deserialize_with = "double_option")]
    java_path: Option<Option<String>>,
    extra_jvm_args: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")]
    select_version: Option<Option<String>>,
    download_source: Option<String>,
    max_concurrent: Option<usize>,
    close_on_launch: Option<bool>,
    game_lang: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    default_account: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    quick_play_server: Option<Option<String>>,
}

/// serde 的 Option<Option<T>> 不能直接区分 missing 与 present null：
/// 两者都会落到外层 None。显式字段反序列化后包一层 Some，apply 就能精确清空。
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

impl SettingsPatch {
    fn apply(self, mut s: Settings) -> Settings {
        if let Some(v) = self.memory_mb {
            s.memory_mb = v;
        }
        if let Some(v) = self.java_path {
            s.java_path = v;
        }
        if let Some(v) = self.extra_jvm_args {
            s.extra_jvm_args = v;
        }
        if let Some(v) = self.select_version {
            s.select_version = v;
        }
        if let Some(v) = self.download_source {
            s.download_source = v;
        }
        if let Some(v) = self.max_concurrent {
            s.max_concurrent = v;
        }
        if let Some(v) = self.close_on_launch {
            s.close_on_launch = v;
        }
        if let Some(v) = self.game_lang {
            s.game_lang = v;
        }
        if let Some(v) = self.default_account {
            s.default_account = v;
        }
        if let Some(v) = self.quick_play_server {
            s.quick_play_server = v;
        }
        s
    }
}

async fn put_settings(
    State(st): State<AppState>,
    Json(patch): Json<SettingsPatch>,
) -> Result<Json<Settings>, ApiError> {
    let merged = patch.apply(st.settings());
    let saved = settings::save(&merged).map_err(ApiError::bad)?;
    st.set_settings(saved.clone());
    Ok(Json(saved))
}

async fn export_settings(State(st): State<AppState>) -> Json<Settings> {
    Json(st.settings())
}

/// 导入设置：接受完整 Settings 或部分对象；缺省字段保持原值，显式 null 清空可空字段。
/// 只写设置，不触碰账号与备份；非法类型与空对象由 backup::merge_settings 拒绝。
async fn import_settings(
    State(st): State<AppState>,
    Json(value): Json<Value>,
) -> Result<Json<Settings>, ApiError> {
    let merged = backup::merge_settings(&st.settings(), &value).map_err(ApiError::bad)?;
    let saved = settings::save(&merged).map_err(ApiError::bad)?;
    st.set_settings(saved.clone());
    Ok(Json(saved))
}

async fn create_backup(State(_st): State<AppState>) -> Result<Json<Value>, ApiError> {
    let e = backup::create().map_err(ApiError::bad)?;
    Ok(Json(json!({
        "id": e.id,
        "fileName": e.file_name,
        "bytes": e.bytes,
        "createdAt": e.created_at,
    })))
}

async fn list_backups(State(_st): State<AppState>) -> Result<Json<Value>, ApiError> {
    let items = backup::list().map_err(ApiError::bad)?;
    let count = items.len();
    Ok(Json(json!({ "items": items, "count": count })))
}

async fn restore_backup(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let restored = backup::restore(&id).map_err(|e| {
        if e.contains("不存在") {
            ApiError::not_found(e)
        } else {
            ApiError::bad(e)
        }
    })?;
    st.set_settings(restored.clone());
    Ok(Json(json!({ "ok": true, "settings": restored })))
}

async fn cleanup_cache(State(_st): State<AppState>) -> Result<Json<Value>, ApiError> {
    let report = backup::cleanup().map_err(ApiError::bad)?;
    Ok(Json(json!({
        "ok": true,
        "freedBytes": report.freed_bytes,
        "removedFiles": report.removed_files,
        "removedDirs": report.removed_dirs,
    })))
}

/// 单个实例详情（UI 的版本详情面板用，不必拉整个 /api/state）。
async fn get_version(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if id.contains('/') || id.contains("..") {
        return Err(ApiError::bad("非法版本 id"));
    }
    if !install::is_installed(&id) {
        return Err(ApiError::not_found(format!("版本 {id} 未安装")));
    }
    let mut info = version_info(&id).ok_or_else(|| ApiError::internal("读取版本元数据失败"))?;
    let mods = modrinth::list_mods(&id);
    let running = st
        .running
        .read()
        .ok()
        .map(|g| {
            g.iter()
                .filter(|(_, r)| r.version_id == id)
                .map(|(pid, _)| json!({ "pid": pid }))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(obj) = info.as_object_mut() {
        obj.insert("mods".into(), json!(mods));
        obj.insert("running".into(), json!(running));
    }
    Ok(Json(info))
}

/// PATCH /api/versions/{id}：显示名、图标、独立存储；缺失字段保留，null 清空。
async fn patch_version(
    Path(id): Path<String>,
    Json(patch): Json<instances::MetaPatch>,
) -> Result<Json<Value>, ApiError> {
    if !instances::valid_id(&id) {
        return Err(ApiError::bad("非法版本 id"));
    }
    if !install::is_installed(&id) {
        return Err(ApiError::not_found(format!("版本 {id} 未安装")));
    }
    let m = instances::patch(&id, patch).map_err(ApiError::bad)?;
    Ok(Json(json!({ "ok": true, "metadata": m })))
}

fn settings_response(
    global: &Settings,
    effective: &Settings,
    override_map: &serde_json::Map<String, Value>,
) -> Value {
    let _ = global;
    json!({ "settings": effective, "override": override_map })
}

/// GET /api/versions/{id}/settings：生效设置 + 当前实例覆盖表。
async fn get_version_settings(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !instances::valid_id(&id) {
        return Err(ApiError::bad("非法版本 id"));
    }
    if !install::is_installed(&id) {
        return Err(ApiError::not_found(format!("版本 {id} 未安装")));
    }
    let global = st.settings();
    let (effective, override_map) = instances::settings_of(&id, &global).map_err(ApiError::bad)?;
    Ok(Json(settings_response(&global, &effective, &override_map)))
}

/// PUT /api/versions/{id}/settings：Partial<Settings>；null 表示删除该覆盖。
async fn put_version_settings(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if !instances::valid_id(&id) {
        return Err(ApiError::bad("非法版本 id"));
    }
    if !install::is_installed(&id) {
        return Err(ApiError::not_found(format!("版本 {id} 未安装")));
    }
    let global = st.settings();
    let (effective, override_map) =
        instances::set_override(&id, &value, &global).map_err(ApiError::bad)?;
    Ok(Json(settings_response(&global, &effective, &override_map)))
}

/// DELETE /api/versions/{id}/settings：清空覆盖，完全跟随全局。
async fn delete_version_settings(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !instances::valid_id(&id) {
        return Err(ApiError::bad("非法版本 id"));
    }
    if !install::is_installed(&id) {
        return Err(ApiError::not_found(format!("版本 {id} 未安装")));
    }
    let global = st.settings();
    let effective = instances::reset_settings(&id, &global).map_err(ApiError::bad)?;
    Ok(Json(
        json!({ "ok": true, "settings": effective, "override": {} }),
    ))
}

async fn get_logs(State(st): State<AppState>, Path(id): Path<String>) -> Json<Value> {
    // 优先给「正在跑的那个进程」的日志，否则给最新一份历史日志
    let running_log = st.running.read().ok().and_then(|g| {
        g.values()
            .filter(|r| r.version_id == id)
            .max_by_key(|r| r.started_at)
            .map(|r| r.log_path.clone())
    });
    let path = match running_log {
        Some(p) => Some(p),
        None => {
            let dir = paths::logs_dir();
            let prefix = format!("{id}-");
            let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
            if let Ok(rd) = std::fs::read_dir(&dir) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !name.starts_with(&prefix) || !name.ends_with(".log") {
                        continue;
                    }
                    if let Ok(m) = e.metadata() {
                        if let Ok(t) = m.modified() {
                            if best.as_ref().map(|(bt, _)| t > *bt).unwrap_or(true) {
                                best = Some((t, e.path()));
                            }
                        }
                    }
                }
            }
            best.map(|(_, p)| p)
        }
    };
    let lines = path.map(|p| launch::tail(&p, 500)).unwrap_or_default();
    Json(json!({ "versionId": id, "lines": lines }))
}

// ── 静态文件 ───────────────────────────────────────────────────

async fn static_file(uri: Uri) -> Response {
    let path = uri.path();
    if path.starts_with("/api/") {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "未知接口" }))).into_response();
    }
    match crate::assets::get(path) {
        Some(f) => {
            let mime = if StdPath::new(path).extension().is_none() {
                mime_guess::mime::TEXT_HTML_UTF_8
            } else {
                mime_guess::from_path(path).first_or_octet_stream()
            };
            let cache: &'static str = if path.starts_with("/assets/") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            // include_dir! 的字节具有 static 生命周期；直接作为 Body，避免每次请求复制近 1 MB JS。
            let mut resp = (StatusCode::OK, f.contents()).into_response();
            resp.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(mime.as_ref())
                    .unwrap_or(HeaderValue::from_static("application/octet-stream")),
            );
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
            resp
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "页面不存在" })),
        )
            .into_response(),
    }
}

// ── 服务 ───────────────────────────────────────────────────────

fn port() -> u16 {
    for key in ["LYCOMC_PORT", "LILYCO_PORT"] {
        if let Ok(v) = std::env::var(key) {
            if let Ok(p) = v.parse::<u16>() {
                return p;
            }
        }
    }
    8766
}

fn state_file() -> PathBuf {
    paths::data_dir().join("web.port")
}

fn remembered_port() -> Option<u16> {
    std::fs::read_to_string(state_file())
        .ok()
        .and_then(|t| t.trim().parse::<u16>().ok())
}

fn remember_port(p: u16) {
    if let Some(d) = state_file().parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(state_file(), p.to_string());
}

async fn alive_at(p: u16) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(900))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let url = format!("http://127.0.0.1:{p}/api/health");
    match client.get(&url).send().await {
        Ok(r) => match r.json::<Value>().await {
            Ok(v) => v.get("name").and_then(|n| n.as_str()) == Some("lycomc"),
            Err(_) => false,
        },
        Err(_) => false,
    }
}

// 本机 Web 可执行程序（Windows .exe / macOS 二进制 / Linux ELF）启动后打开默认浏览器。
// Web 优先下这是主入口体验；可选桌面壳 feature 不参与这里。
#[cfg(target_os = "windows")]
fn browser_program() -> &'static str {
    "rundll32"
}

#[cfg(target_os = "macos")]
fn browser_program() -> &'static str {
    "open"
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn browser_program() -> &'static str {
    "xdg-open"
}

#[cfg(target_os = "windows")]
fn browser_prefix_arg() -> Option<&'static str> {
    Some("url.dll,FileProtocolHandler")
}

#[cfg(not(target_os = "windows"))]
fn browser_prefix_arg() -> Option<&'static str> {
    None
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn browser_needs_display() -> bool {
    false
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn browser_needs_display() -> bool {
    true
}

fn open_in_browser(url: &str) {
    let mut cmd = std::process::Command::new(browser_program());
    if let Some(prefix) = browser_prefix_arg() {
        cmd.arg(prefix);
    }
    cmd.arg(url);
    let _ = cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

fn maybe_open_browser(url: &str) {
    if std::env::var("LYCOMC_NO_OPEN")
        .map(|v| v == "1")
        .unwrap_or(false)
    {
        return;
    }
    if browser_needs_display()
        && std::env::var("DISPLAY").is_err()
        && std::env::var("WAYLAND_DISPLAY").is_err()
    {
        return;
    }
    open_in_browser(url);
}

pub fn serve() {
    let _ = paths::ensure_all();
    let s = settings::load();
    let port = port();
    let st = AppState::new(s);
    set_global_running(Arc::clone(&st.running));
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    rt.block_on(async move {
        if let Some(p) = remembered_port() {
            if alive_at(p).await {
                let url = format!("http://127.0.0.1:{p}");
                println!("lycomc 已在运行: {url}");
                maybe_open_browser(&url);
                return;
            }
        }
        let app = router(st);
        let mut listener = None;
        let mut chosen = port;
        let mut last_err = String::new();
        for candidate in port..port.saturating_add(20) {
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], candidate));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => {
                    listener = Some(l);
                    chosen = candidate;
                    break;
                }
                Err(e) => last_err = format!("{e}"),
            }
        }
        let Some(listener) = listener else {
            eprintln!(
                "lycomc: 绑定 127.0.0.1:{port}..{} 全部失败: {last_err}",
                port.saturating_add(20)
            );
            std::process::exit(1);
        };
        let url = format!("http://127.0.0.1:{chosen}");
        remember_port(chosen);
        println!("lycomc Web 控制台: {url}");
        if crate::assets::embedded() {
            println!("前端已编入二进制（webMode=embedded）");
        } else {
            println!("警告：web/dist 为空，页面不可用（请先在 web/ 里 pnpm build）");
        }
        println!("数据目录: {}", paths::data_dir().display());
        maybe_open_browser(&url);
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("lycomc: HTTP 服务异常退出: {e}");
        }
    });
}

/// 给桌面壳 / Android WebView 用：后台启动内嵌 axum，返回实际监听端口。
/// 不打印地址、不写 web.port、不打开浏览器；端口只是进程内部实现细节。
pub fn start_embedded() -> u16 {
    let _ = paths::ensure_all();
    let (tx, rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    std::thread::Builder::new()
        .name("lycomc-embedded-api".into())
        .spawn(move || {
            let st = AppState::new(settings::load());
            set_global_running(Arc::clone(&st.running));
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = tx.send(Err(format!("tokio: {e}")));
                    return;
                }
            };
            rt.block_on(async move {
                // 端口 0 交给内核选一个空闲端口，用户永远不需要知道端口或 IP。
                let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 0u16));
                let listener = match tokio::net::TcpListener::bind(addr).await {
                    Ok(l) => l,
                    Err(e) => {
                        let _ = tx.send(Err(format!("无法启动本地服务: {e}")));
                        return;
                    }
                };
                let chosen = match listener.local_addr() {
                    Ok(a) => a.port(),
                    Err(e) => {
                        let _ = tx.send(Err(format!("无法读取本地服务地址: {e}")));
                        return;
                    }
                };
                let _ = tx.send(Ok(chosen));
                if let Err(e) = axum::serve(listener, router(st)).await {
                    eprintln!("lycomc: 内嵌服务异常退出: {e}");
                }
            });
        })
        .expect("spawn embedded api thread");
    rx.recv()
        .unwrap_or_else(|e| Err(format!("embedded api: {e}")))
        .unwrap_or_else(|e| panic!("lycomc 内嵌服务启动失败: {e}"))
}

#[cfg(test)]
mod browser_launch_tests {
    use super::*;

    #[test]
    fn default_web_binary_uses_platform_browser() {
        #[cfg(target_os = "linux")]
        {
            assert_eq!(browser_program(), "xdg-open");
            assert!(browser_needs_display());
            assert_eq!(browser_prefix_arg(), None);
        }
        #[cfg(target_os = "windows")]
        {
            assert_eq!(browser_program(), "rundll32");
            assert!(!browser_needs_display());
            assert_eq!(browser_prefix_arg(), Some("url.dll,FileProtocolHandler"));
        }
        #[cfg(target_os = "macos")]
        {
            assert_eq!(browser_program(), "open");
            assert!(!browser_needs_display());
            assert_eq!(browser_prefix_arg(), None);
        }
    }
}

#[cfg(test)]
mod settings_patch_tests {
    use super::*;

    fn baseline() -> Settings {
        Settings {
            memory_mb: 6144,
            java_path: Some("/usr/bin/java".to_string()),
            select_version: Some("1.20.1".to_string()),
            default_account: Some("Steve".to_string()),
            quick_play_server: Some("persisted.example.net".to_string()),
            ..Settings::default()
        }
    }

    #[test]
    fn missing_nullable_fields_keep_existing_values() {
        let patch: SettingsPatch = serde_json::from_str(r#"{"memoryMb":8192}"#).unwrap();
        let s = patch.apply(baseline());
        assert_eq!(s.memory_mb, 8192);
        assert_eq!(s.java_path.as_deref(), Some("/usr/bin/java"));
        assert_eq!(s.select_version.as_deref(), Some("1.20.1"));
        assert_eq!(s.default_account.as_deref(), Some("Steve"));
        assert_eq!(
            s.quick_play_server.as_deref(),
            Some("persisted.example.net")
        );
    }

    #[test]
    fn explicit_null_clears_all_nullable_fields() {
        let patch: SettingsPatch = serde_json::from_str(
            r#"{"javaPath":null,"selectVersion":null,"defaultAccount":null,"quickPlayServer":null}"#,
        )
        .unwrap();
        let s = patch.apply(baseline());
        assert_eq!(s.java_path, None);
        assert_eq!(s.select_version, None);
        assert_eq!(s.default_account, None);
        assert_eq!(s.quick_play_server, None);
        assert_eq!(s.memory_mb, 6144);
    }

    #[test]
    fn explicit_values_update_nullable_fields() {
        let patch: SettingsPatch = serde_json::from_str(
            r#"{"javaPath":"/opt/jdk/bin/java","selectVersion":"26.3","defaultAccount":"Alex","quickPlayServer":"mc.example.net:25565"}"#,
        )
        .unwrap();
        let s = patch.apply(baseline());
        assert_eq!(s.java_path.as_deref(), Some("/opt/jdk/bin/java"));
        assert_eq!(s.select_version.as_deref(), Some("26.3"));
        assert_eq!(s.default_account.as_deref(), Some("Alex"));
        assert_eq!(s.quick_play_server.as_deref(), Some("mc.example.net:25565"));
    }

    #[test]
    fn explicit_null_clears_only_the_requested_nullable_field() {
        let patch: SettingsPatch = serde_json::from_str(r#"{"defaultAccount":null}"#).unwrap();
        let s = patch.apply(baseline());
        assert_eq!(s.default_account, None);
        assert_eq!(s.java_path.as_deref(), Some("/usr/bin/java"));
        assert_eq!(s.select_version.as_deref(), Some("1.20.1"));
    }
}

#[cfg(test)]
mod launch_request_tests {
    use super::*;

    fn req(server: Option<&str>) -> LaunchReq {
        LaunchReq {
            version_id: "1.20.1".to_string(),
            account_name: None,
            memory_mb: None,
            server: server.map(|s| Some(s.to_string())),
        }
    }

    fn addr(q: Option<launch::QuickPlay>) -> Option<String> {
        q.map(|launch::QuickPlay::Multiplayer(a)| a)
    }

    #[test]
    fn launch_server_override_beats_settings_default() {
        let s = Settings {
            quick_play_server: Some("default.example.net".to_string()),
            ..Settings::default()
        };
        assert_eq!(
            addr(resolve_quick_play(&req(None), &s)).as_deref(),
            Some("default.example.net")
        );
        assert_eq!(addr(resolve_quick_play(&req(Some("")), &s)), None);
        assert_eq!(
            addr(resolve_quick_play(&req(Some("mc.example.net:25565")), &s)).as_deref(),
            Some("mc.example.net:25565")
        );
        assert_eq!(
            addr(resolve_quick_play(&req(Some("bad address")), &s)),
            None
        );
    }

    #[test]
    fn launch_request_json_distinguishes_missing_null_and_empty() {
        let missing: LaunchReq = serde_json::from_str(r#"{"versionId":"1.20.1"}"#).unwrap();
        assert!(missing.server.is_none());
        let explicit_null: LaunchReq =
            serde_json::from_str(r#"{"versionId":"1.20.1","server":null}"#).unwrap();
        assert_eq!(explicit_null.server, Some(None));
        let empty: LaunchReq =
            serde_json::from_str(r#"{"versionId":"1.20.1","server":""}"#).unwrap();
        assert_eq!(empty.server, Some(Some(String::new())));
    }
}

#[cfg(all(test, unix))]
mod process_control_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn request_then_force_exit_stops_sigterm_ignoring_child() {
        // exec 让 sh 被 sleep 替换，只留一个进程；SIG_IGN 跨 exec 保留，
        // 因此 SIGTERM 被忽略，必须由 SIGKILL 收尾；覆盖两段式路径且不残留后代。
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg("trap '' TERM; exec sleep 30")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn sh");
        let pid = child.id();
        request_game_exit(pid).expect("SIGTERM 应成功投递");
        force_game_exit(pid).expect("SIGKILL 应成功投递");
        let started = Instant::now();
        let status = child.wait().expect("wait child");
        assert!(!status.success(), "子进程应被强制结束");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "强制结束后 wait 不应挂起: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn missing_process_is_treated_as_already_exited() {
        // 2_000_000_000 远超常见 pid_max，必定 ESRCH；正数 pid_t 避免 -1 误伤。
        assert!(request_game_exit(2_000_000_000).is_ok());
        assert!(force_game_exit(2_000_000_000).is_ok());
    }

    #[test]
    fn out_of_range_pid_is_rejected_before_kill() {
        // u32::MAX 会溢出 i32 pid_t，必须在调用 kill 前拒绝，防止 kill(-1, ...)。
        assert!(request_game_exit(u32::MAX).is_err());
    }
}
