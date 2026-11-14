//! Java 管理：探测系统 JRE、按 need 版本选最优、必要时从 Adoptium 下载托管 JRE。

use std::io::Read;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::meta::{self, Source};
use super::{paths, ProgressFn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInfo {
    pub path: String,
    pub version: u32,
    pub source: String,
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// 跑 java -version，从 stderr 抠 major 版本；卡住的候选最多等 2 秒后杀掉。
pub fn probe(path: &Path) -> Option<JavaInfo> {
    let mut command = Command::new(path);
    command
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // 两个管道必须由独立线程持续排空，否则输出超过 pipe buffer 的候选会卡在 write。
    // 超时路径不 join 读取线程：若后代进程仍持有 fd，线程随管道关闭自行退出；
    // Unix 下还会杀掉整个进程组，主线程不会被 scope 的隐式 join 拖死。
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let tx_out = tx.clone();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stdout {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = tx_out.send(buf);
    });
    let tx_err = tx.clone();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut pipe) = stderr {
            let _ = pipe.read_to_end(&mut buf);
        }
        let _ = tx_err.send(buf);
    });
    drop(tx);

    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        if child.try_wait().ok()?.is_some() {
            let _ = child.wait();
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            #[cfg(unix)]
            terminate_probe_group(&child);
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    // 正常退出也可能有后代继续持有管道；统一以 2 秒为上限等待 EOF。
    // 超时则放弃该候选并清理 Unix 进程组，避免验收线程被后台进程拖住。
    let read_deadline = Instant::now() + PROBE_TIMEOUT;
    let mut combined = Vec::new();
    for _ in 0..2 {
        let left = read_deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            #[cfg(unix)]
            terminate_probe_group(&child);
            return None;
        }
        let mut buf = rx.recv_timeout(left).ok()?;
        combined.append(&mut buf);
    }
    let text = String::from_utf8_lossy(&combined);
    let version = parse_major(&text)?;
    Some(JavaInfo {
        path: path.display().to_string(),
        version,
        source: "system".into(),
    })
}
#[cfg(unix)]
fn terminate_probe_group(child: &std::process::Child) {
    // 超时候选可能把 fd 交给 sleep 等后代；杀掉整个进程组，防止主线程被 read_to_end 拖住。
    // setpgid(0,0) 子进程组 id 等于其 pid。
    unsafe {
        libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
}

/// 从 `openjdk version "17.0.20.1" 2026-08-18` 抠 17；兼容 "1.8.0_392" → 8
pub fn parse_major(text: &str) -> Option<u32> {
    for line in text.lines() {
        let Some(idx) = line.find("version \"") else {
            continue;
        };
        let rest = &line[idx + "version \"".len()..];
        let Some(end) = rest.find('"') else { continue };
        let v = &rest[..end];
        let mut it = v.split('.');
        let first: u32 = it.next()?.parse().ok()?;
        if first == 1 {
            return it.next()?.parse().ok();
        }
        return Some(first);
    }
    None
}

/// 扫描常见安装点 + JAVA_HOME + PATH。
///
/// Web 主页每秒都要读 /api/state；Java 安装目录在两次刷新之间通常不变，
/// 这里按数据目录缓存 30 秒，并把每个候选的探测限制在 2 秒内、最多并行 4 个，
/// 避免一个挂死的 java 进程把整个 axum worker 线程拖住。
/// CLI javas / 启动前选 JRE 仍直接扫盘。
pub fn scan_system() -> Vec<JavaInfo> {
    cached_scan(false)
}

/// 强制绕过缓存：用户刚装完 Java、或调用方需要绝对新鲜的数据时使用。
pub fn scan_system_fresh() -> Vec<JavaInfo> {
    cached_scan(true)
}

struct ScanCache {
    key: PathBuf,
    at: Instant,
    items: Vec<JavaInfo>,
}

static SCAN_CACHE: OnceLock<Mutex<Option<ScanCache>>> = OnceLock::new();
const SCAN_TTL: Duration = Duration::from_secs(30);

fn cached_scan(force: bool) -> Vec<JavaInfo> {
    let key = paths::data_dir();
    let lock = SCAN_CACHE.get_or_init(|| Mutex::new(None));
    if !force {
        if let Ok(g) = lock.lock() {
            if let Some(c) = g.as_ref() {
                if c.key == key && c.at.elapsed() < SCAN_TTL {
                    return c.items.clone();
                }
            }
        }
    }
    let items = scan_system_uncached();
    if let Ok(mut g) = lock.lock() {
        *g = Some(ScanCache {
            key,
            at: Instant::now(),
            items: items.clone(),
        });
    }
    items
}

fn scan_system_uncached() -> Vec<JavaInfo> {
    let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
    let mut push = |p: PathBuf, source: &'static str| {
        let key = p.display().to_string();
        if !candidates
            .iter()
            .any(|(q, _)| q.display().to_string() == key)
        {
            candidates.push((p, source));
        }
    };
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        push(PathBuf::from(home).join("bin").join(java_bin()), "system");
    }
    for base in [
        "/usr/lib/jvm",
        "/usr/java",
        "/opt/java",
        "/opt/jdk",
        "/Library/Java/JavaVirtualMachines",
    ] {
        let Ok(rd) = std::fs::read_dir(base) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            for cand in [
                p.join("bin").join(java_bin()),
                p.join("Contents/Home/bin").join(java_bin()),
            ] {
                if cand.is_file() {
                    push(cand, "system");
                }
            }
        }
    }
    // PATH 里的 java
    if let Ok(out) = Command::new("which").arg("java").output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            push(PathBuf::from(s), "system");
        }
    }
    // 托管 JRE
    if let Ok(rd) = std::fs::read_dir(paths::java_dir()) {
        for e in rd.flatten() {
            let p = e.path().join("bin").join(java_bin());
            if p.is_file() {
                push(p, "managed");
            }
        }
    }
    let mut found: Vec<JavaInfo> = probe_candidates(candidates);
    found.sort_by_key(|j| j.version);
    found.dedup_by(|a, b| a.path == b.path);
    found
}

fn probe_candidates(candidates: Vec<(PathBuf, &'static str)>) -> Vec<JavaInfo> {
    let queue = Arc::new(Mutex::new(
        candidates
            .into_iter()
            .collect::<std::collections::VecDeque<_>>(),
    ));
    let workers = queue.lock().map(|q| q.len().clamp(1, 4)).unwrap_or(1);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        for _ in 0..workers {
            let queue = Arc::clone(&queue);
            let tx = tx.clone();
            scope.spawn(move || loop {
                let next = queue.lock().ok().and_then(|mut q| q.pop_front());
                let Some((path, source)) = next else { break };
                if let Some(mut info) = probe(&path) {
                    info.source = source.into();
                    let _ = tx.send(info);
                }
            });
        }
        drop(tx);
        let found: Vec<JavaInfo> = rx.into_iter().collect();
        found
    })
}

fn java_bin() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

/// 选一个满足 demanded major 的 JRE：优先精确匹配，其次更高版本
pub fn pick(required: u32) -> Option<JavaInfo> {
    // 启动前必须看见刚装好的 JRE，不能等 30 秒缓存过期。
    let all = scan_system_fresh();
    all.iter()
        .filter(|j| j.version == required)
        .max_by_key(|j| j.version)
        .cloned()
        .or_else(|| {
            all.iter()
                .filter(|j| j.version > required && j.version <= required + 8)
                .min_by_key(|j| j.version)
                .cloned()
        })
}

/// 从 Adoptium 下载一个 JRE 到 java/<major>/，返回 java 可执行路径
pub async fn ensure(
    required: u32,
    source: Source,
    progress: ProgressFn<'_>,
) -> Result<PathBuf, String> {
    if let Some(j) = pick(required) {
        progress(super::pct(
            100.0,
            format!("使用已有 Java {}（{}）", j.version, j.source),
        ));
        return Ok(PathBuf::from(j.path));
    }
    let target = paths::java_dir().join(required.to_string());
    let bin = target.join("bin").join(java_bin());
    if bin.is_file() {
        if let Some(i) = probe(&bin) {
            if i.version == required {
                return Ok(bin);
            }
        }
    }
    progress(super::pct(
        0.0,
        format!("本机缺 Java {required}，正在下载托管 JRE…"),
    ));
    let (os, arch) = adoptium_platform();
    let official = format!(
        "https://api.adoptium.net/v3/binary/latest/{required}/ga/{os}/{arch}/jre/hotspot/normal/eclipse?project=jdk"
    );
    let c = meta::client();
    // 国内镜像：清华 TUNA 的 Adoptium 目录里有 JRE tar.gz（linux/mac）。
    // 逐个候选尝试，必须拿到 gzip 魔数才算成功，避免把 404 页面当成 JRE 解包。
    let mut urls: Vec<String> = Vec::new();
    if source == Source::Bmcl && os != "windows" {
        if let Some(u) = tuna_jre_url(&c, required, os, arch).await {
            urls.push(u);
        }
    }
    urls.push(official.clone());
    let mut bytes: Option<Vec<u8>> = None;
    let mut last = String::new();
    for u in &urls {
        match c.get(u).send().await {
            Ok(r) if r.status().is_success() => match r.bytes().await {
                Ok(b) if b.len() > 2 && b[0] == 0x1f && b[1] == 0x8b => {
                    progress(super::pct(
                        20.0,
                        format!("已从国内镜像取得 Java {required} 运行时…"),
                    ));
                    bytes = Some(b.to_vec());
                    break;
                }
                Ok(_) => last = format!("{u}: 返回的不是 tar.gz"),
                Err(e) => last = format!("{u}: {e}"),
            },
            Ok(r) => last = format!("{u}: HTTP {}", r.status()),
            Err(e) => last = format!("{u}: {e}"),
        }
    }
    let bytes = bytes.ok_or_else(|| format!("下载 Java {required} 失败（{last}）"))?;
    progress(super::pct(
        60.0,
        format!(
            "已下载 {:.1} MB，正在解包…",
            bytes.len() as f64 / 1_048_576.0
        ),
    ));
    let staging = paths::java_dir().join(format!("{required}.tmp"));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    extract_archive(&bytes, &staging)?;
    // tar.gz 解出来多一层目录，把它提上来
    let root = single_root(&staging).unwrap_or_else(|| staging.clone());
    if target.exists() {
        let _ = std::fs::remove_dir_all(&target);
    }
    if root != staging {
        std::fs::rename(&root, &target).map_err(|e| format!("安装 JRE 失败: {e}"))?;
        let _ = std::fs::remove_dir_all(&staging);
    } else {
        std::fs::rename(&staging, &target).map_err(|e| format!("安装 JRE 失败: {e}"))?;
    }
    let bin = target.join("bin").join(java_bin());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755));
    }
    if !bin.is_file() {
        return Err(format!("托管 JRE 解包后找不到 {}", bin.display()));
    }
    progress(super::pct(100.0, format!("Java {required} 就绪")));
    Ok(bin)
}

/// 从清华 TUNA 的 Adoptium 目录页里挑出当前平台的 JRE 包名。
/// 目录文件名形如 OpenJDK17U-jre_x64_linux_hotspot_17.0.21_9.tar.gz。
async fn tuna_jre_url(c: &reqwest::Client, required: u32, os: &str, arch: &str) -> Option<String> {
    let dir = format!("https://mirrors.tuna.tsinghua.edu.cn/Adoptium/{required}/jre/{arch}/{os}/");
    let text = c.get(&dir).send().await.ok()?.text().await.ok()?;
    tuna_jre_name(&text, arch, os).map(|name| format!("{dir}{name}"))
}

/// 纯解析：从 TUNA 目录页里挑出当前平台的 JRE 包名。
fn tuna_jre_name(text: &str, arch: &str, os: &str) -> Option<String> {
    let needle = format!("jre_{arch}_{os}_hotspot_");
    for part in text.split('"') {
        if part.starts_with("OpenJDK") && part.contains(&needle) && part.ends_with(".tar.gz") {
            return Some(part.to_string());
        }
    }
    None
}

fn adoptium_platform() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        "x86" => "x32",
        other => other,
    };
    (os, arch)
}

fn single_root(dir: &Path) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .collect();
    entries.retain(|p| p.is_dir());
    if entries.len() == 1 {
        Some(entries.remove(0))
    } else {
        None
    }
}

/// 解 .tar.gz（Adoptium Linux 默认格式）
pub fn extract_archive(bytes: &[u8], dest: &Path) -> Result<(), String> {
    // 通过系统 tar 解压（Rust 侧不引 tar+gzip 两个大依赖）
    let tmp = dest.join("__pkg.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("写临时包失败: {e}"))?;
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(&tmp)
        .arg("-C")
        .arg(dest)
        .status()
        .map_err(|e| format!("调用 tar 失败: {e}"))?;
    let _ = std::fs::remove_file(&tmp);
    if !status.success() {
        return Err("解压 JRE 包失败（tar 非零退出）".into());
    }
    Ok(())
}

#[cfg(test)]
mod mirror_tests {
    #[cfg(unix)]
    use super::probe;
    use super::{tuna_jre_name, PROBE_TIMEOUT, SCAN_TTL};
    use std::time::Duration;
    #[cfg(unix)]
    use std::time::Instant;

    #[cfg(unix)]
    fn probe_script(label: &str, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "lycomc-java-probe-{}-{}-{nanos}.sh",
            std::process::id(),
            label
        ));
        let script = format!("#!/usr/bin/env sh\n{body}\n");
        std::fs::write(&path, script).unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).unwrap();
        path
    }

    #[test]
    fn probe_bounds_and_cache_ttl_are_configured() {
        assert_eq!(PROBE_TIMEOUT, Duration::from_secs(2));
        assert_eq!(SCAN_TTL, Duration::from_secs(30));
    }

    #[cfg(unix)]
    #[test]
    fn probe_drains_large_output_without_deadlock() {
        let script = probe_script(
            "large",
            "head -c 1048576 /dev/zero | tr '\\0' 'x'
head -c 1048576 /dev/zero | tr '\\0' 'y' >&2
printf 'openjdk version \"17.0.20.1\" 2026-08-18\\n' >&2",
        );
        let started = Instant::now();
        let found = probe(&script);
        std::fs::remove_file(&script).ok();
        assert_eq!(found.map(|j| j.version), Some(17));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "大输出探测不应等到超时: {:?}",
            started.elapsed()
        );
    }

    #[cfg(unix)]
    #[test]
    fn probe_times_out_slow_candidate() {
        let script = probe_script("slow", "sleep 5");
        let started = Instant::now();
        let found = probe(&script);
        std::fs::remove_file(&script).ok();
        assert!(found.is_none());
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "挂起探测必须在 2 秒量级返回: {:?}",
            started.elapsed()
        );
    }

    #[cfg(unix)]
    #[test]
    fn probe_bounds_detached_descendant_holding_pipes() {
        let script = probe_script(
            "detached",
            "sleep 5 &\nprintf 'openjdk version \"17.0.20.1\" 2026-08-18\\n' >&2\nexit 0",
        );
        let started = Instant::now();
        let found = probe(&script);
        std::fs::remove_file(&script).ok();
        assert!(found.is_none());
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "后代持有管道时探测必须有界返回: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn parses_tuna_jre_directory() {
        let page = r#"<a href="../">../</a>
<a href="OpenJDK17U-jre_x64_linux_hotspot_17.0.21_9.tar.gz">OpenJDK17U-jre_x64_linux_hotspot_17.0.21_9.tar.gz</a>
<a href="OpenJDK17U-jdk_x64_linux_hotspot_17.0.21_9.tar.gz">jdk</a>"#;
        assert_eq!(
            tuna_jre_name(page, "x64", "linux"),
            Some("OpenJDK17U-jre_x64_linux_hotspot_17.0.21_9.tar.gz".into())
        );
        assert_eq!(tuna_jre_name(page, "aarch64", "linux"), None);
    }
}
