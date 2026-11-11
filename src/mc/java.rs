//! Java 管理：探测系统 JRE、按 need 版本选最优、必要时从 Adoptium 下载托管 JRE。

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::meta::{self, Source};
use super::{paths, ProgressFn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInfo {
    pub path: String,
    pub version: u32,
    pub source: String,
}

/// 跑 java -version，从 stderr 抠 major 版本
pub fn probe(path: &Path) -> Option<JavaInfo> {
    let out = Command::new(path).arg("-version").output().ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    );
    let version = parse_major(&text)?;
    Some(JavaInfo { path: path.display().to_string(), version, source: "system".into() })
}

/// 从 `openjdk version "17.0.20.1" 2026-08-18` 抠 17；兼容 "1.8.0_392" → 8
pub fn parse_major(text: &str) -> Option<u32> {
    for line in text.lines() {
        let Some(idx) = line.find("version \"") else { continue };
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

/// 扫描常见安装点 + JAVA_HOME + PATH
pub fn scan_system() -> Vec<JavaInfo> {
    let mut found: Vec<JavaInfo> = Vec::new();
    let mut push = |p: PathBuf| {
        if found.iter().any(|f| f.path == p.display().to_string()) {
            return;
        }
        if let Some(i) = probe(&p) {
            found.push(i);
        }
    };
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        push(PathBuf::from(home).join("bin").join(java_bin()));
    }
    for base in [
        "/usr/lib/jvm",
        "/usr/java",
        "/opt/java",
        "/opt/jdk",
        "/Library/Java/JavaVirtualMachines",
    ] {
        let Ok(rd) = std::fs::read_dir(base) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            for cand in [
                p.join("bin").join(java_bin()),
                p.join("Contents/Home/bin").join(java_bin()),
            ] {
                if cand.is_file() {
                    push(cand);
                }
            }
        }
    }
    // PATH 里的 java
    if let Ok(out) = Command::new("which").arg("java").output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            push(PathBuf::from(s));
        }
    }
    // 托管 JRE
    if let Ok(rd) = std::fs::read_dir(paths::java_dir()) {
        for e in rd.flatten() {
            let p = e.path().join("bin").join(java_bin());
            if p.is_file() {
                if let Some(mut i) = probe(&p) {
                    i.source = "managed".into();
                    found.push(i);
                }
            }
        }
    }
    found.sort_by_key(|j| j.version);
    found.dedup_by(|a, b| a.path == b.path);
    found
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
    let all = scan_system();
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
pub async fn ensure(required: u32, source: Source, progress: ProgressFn<'_>) -> Result<PathBuf, String> {
    if let Some(j) = pick(required) {
        progress(super::pct(100.0, format!("使用已有 Java {}（{}）", j.version, j.source)));
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
    progress(super::pct(0.0, format!("本机缺 Java {required}，正在下载托管 JRE…")));
    let (os, arch) = adoptium_platform();
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{required}/ga/{os}/{arch}/jre/hotspot/normal/eclipse?project=jdk"
    );
    let c = meta::client();
    let resp = c
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求 Adoptium 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Adoptium 返回 HTTP {}（Java {required} / {os}-{arch}）", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    progress(super::pct(60.0, format!("已下载 {:.1} MB，正在解包…", bytes.len() as f64 / 1_048_576.0)));
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
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).collect();
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
