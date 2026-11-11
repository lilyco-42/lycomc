//! 带校验的并发下载器：URL → 文件，sha1 校验，失败重试，镜像回落。
//!
//! 所有写入先落 .part 再 rename，避免半个文件被当成已完成。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use sha1::{Digest, Sha1};
use tokio::io::AsyncWriteExt;

use super::meta::{self, Source};
use super::{Progress, ProgressFn};

/// 一个待下载项
#[derive(Debug, Clone)]
pub struct Item {
    pub url: String,
    pub dest: PathBuf,
    /// 期望 sha1（小写十六进制）；None 表示不校验
    pub sha1: Option<String>,
    /// 期望大小（用于进度估算与提前跳过）
    pub size: Option<u64>,
}

/// 下载统计
#[derive(Debug, Default, Clone)]
pub struct Stats {
    pub total: usize,
    pub skipped: usize,
    pub downloaded: usize,
    pub bytes: u64,
}

fn file_ok(path: &Path, sha1_hex: Option<&str>, size: Option<u64>) -> bool {
    let Ok(md) = std::fs::metadata(path) else { return false };
    if !md.is_file() {
        return false;
    }
    if let Some(sz) = size {
        if sz > 0 && md.len() != sz {
            return false;
        }
    }
    let Some(want) = sha1_hex else { return true };
    if want.is_empty() {
        return true;
    }
    sha1_file(path).map(|h| h.eq_ignore_ascii_case(want)).unwrap_or(false)
}

pub fn sha1_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 并发下载一批，返回统计。单项失败即整体失败（上层决定是否重试）。
pub async fn fetch_all(
    items: Vec<Item>,
    source: Source,
    concurrency: usize,
    progress: ProgressFn<'_>,
) -> Result<Stats, String> {
    let mut todo: Vec<Item> = Vec::new();
    let mut stats = Stats { total: items.len(), ..Default::default() };
    for it in items {
        if file_ok(&it.dest, it.sha1.as_deref(), it.size) {
            stats.skipped += 1;
        } else {
            todo.push(it);
        }
    }
    let total_bytes: u64 = todo.iter().filter_map(|i| i.size).sum();
    let done_bytes = Arc::new(AtomicU64::new(0));
    let done_count = Arc::new(AtomicU64::new(0));
    let todo_len = todo.len();

    if todo.is_empty() {
        progress(Progress { percent: 100.0, message: "文件均已存在，跳过下载".into(), log: None });
        return Ok(stats);
    }

    let c = meta::client();
    let sem = Arc::new(tokio::sync::Semaphore::new(concurrency.max(1)));
    let mut tasks = Vec::new();
    for it in todo {
        let c = c.clone();
        let sem = Arc::clone(&sem);
        let db = Arc::clone(&done_bytes);
        let dc = Arc::clone(&done_count);
        tasks.push(tokio::spawn(async move {
            let _permit = sem.acquire_owned().await.map_err(|e| e.to_string())?;
            let n = one(&c, &it, source, &db, total_bytes).await?;
            dc.fetch_add(1, Ordering::Relaxed);
            let dc_now = dc.load(Ordering::Relaxed) as f64;
            let db_now = db.load(Ordering::Relaxed);
            let byte_pct = if total_bytes > 0 {
                (db_now as f64 / total_bytes as f64) * 100.0
            } else {
                (dc_now / todo_len as f64) * 100.0
            };
            Ok::<(u64, f64), String>((
                n,
                byte_pct.min(99.0),
            ))
        }));
    }

    // 进度泵：与下载任务并发跑在同一 task 内（不 spawn，避免借用逃逸 'static）
    let finished = Arc::new(AtomicUsize::new(0));
    let pump = {
        let db = Arc::clone(&done_bytes);
        let dc = Arc::clone(&done_count);
        let fin = Arc::clone(&finished);
        async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                let c = dc.load(Ordering::Relaxed);
                let b = db.load(Ordering::Relaxed);
                let pct = if total_bytes > 0 {
                    (b as f64 / total_bytes as f64) * 100.0
                } else {
                    (c as f64 / todo_len as f64) * 100.0
                };
                progress(Progress {
                    percent: pct.clamp(0.0, 99.0),
                    message: format!(
                        "下载中 {}/{} · {:.1} MB / {:.1} MB",
                        c,
                        todo_len,
                        b as f64 / 1_048_576.0,
                        total_bytes as f64 / 1_048_576.0
                    ),
                    log: None,
                });
                if c as usize >= todo_len || fin.load(Ordering::Relaxed) >= todo_len {
                    break;
                }
            }
        }
    };

    let drain = async {
        let mut bytes = 0u64;
        let mut count = 0usize;
        let mut first_err: Option<String> = None;
        for t in tasks {
            let r = t.await;
            finished.fetch_add(1, Ordering::Relaxed);
            match r {
                Ok(Ok((n, _))) => {
                    bytes += n;
                    count += 1;
                }
                Ok(Err(e)) => {
                    if first_err.is_none() {
                        first_err = Some(e);
                    }
                }
                Err(e) => {
                    if first_err.is_none() {
                        first_err = Some(format!("下载线程崩溃: {e}"));
                    }
                }
            }
        }
        (bytes, count, first_err)
    };

    let (bytes, count, first_err) = futures_util::future::join(drain, pump).await.0;

    if let Some(e) = first_err {
        return Err(e);
    }
    stats.downloaded = count;
    stats.bytes = bytes;
    progress(Progress { percent: 100.0, message: "下载完成".into(), log: None });
    Ok(stats)
}

/// 单个文件：先试镜像（若配置了），失败回落官方；再失败重试一次
async fn one(
    c: &reqwest::Client,
    it: &Item,
    source: Source,
    done_bytes: &Arc<AtomicU64>,
    _total: u64,
) -> Result<u64, String> {
    let mut candidates = vec![source.rewrite(&it.url)];
    if source != Source::Mojang {
        candidates.push(it.url.clone());
    }
    // Modrinth 文件走 MCIM 中国镜像优先；CDN 必须保留 /data/ 前缀。
    // MCIM 会 302 回官方 CDN，失败时下面的循环继续用官方直连兜底。
    if let Some(m) = super::modrinth::mirror_cdn(&it.url) {
        candidates.insert(0, m);
    }
    candidates.dedup();
    if let Some(dir) = it.dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录 {} 失败: {e}", dir.display()))?;
    }
    let part = it.dest.with_extension(format!(
        "{}part",
        it.dest.extension().and_then(|e| e.to_str()).map(|e| format!("{e}.")).unwrap_or_default()
    ));
    let mut last_err = String::new();
    for (attempt, url) in candidates.iter().enumerate() {
        match stream_to(c, url, &part, done_bytes).await {
            Ok(n) => {
                if let Some(want) = &it.sha1 {
                    if !want.is_empty() {
                        let got = sha1_file(&part)?;
                        if !got.eq_ignore_ascii_case(want) {
                            let _ = std::fs::remove_file(&part);
                            last_err = format!("sha1 不匹配 {}：期望 {} 实际 {}", url, want, got);
                            continue;
                        }
                    }
                }
                std::fs::rename(&part, &it.dest)
                    .map_err(|e| format!("落地 {} 失败: {e}", it.dest.display()))?;
                return Ok(n);
            }
            Err(e) => {
                last_err = format!("{e}（{url}）");
                if attempt == candidates.len() - 1 {
                    // 最后再给一次机会
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    if let Ok(n) = stream_to(c, url, &part, done_bytes).await {
                        std::fs::rename(&part, &it.dest).ok();
                        return Ok(n);
                    }
                }
            }
        }
    }
    Err(format!("下载 {} 失败: {last_err}", it.dest.display()))
}

async fn stream_to(
    c: &reqwest::Client,
    url: &str,
    part: &Path,
    done: &Arc<AtomicU64>,
) -> Result<u64, String> {
    let resp = c.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut f = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut n = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        f.write_all(&chunk).await.map_err(|e| e.to_string())?;
        n += chunk.len() as u64;
        done.fetch_add(chunk.len() as u64, Ordering::Relaxed);
    }
    f.flush().await.map_err(|e| e.to_string())?;
    Ok(n)
}

/// 下载一个 URL 到内存（元数据用）
pub async fn fetch_text(url: &str, source: Source) -> Result<String, String> {
    let c = meta::client();
    let u = source.rewrite(url);
    let r = match c.get(&u).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => c.get(url).send().await.map_err(|e| format!("请求 {url} 失败: {e}"))?,
    };
    if !r.status().is_success() {
        return Err(format!("{} 返回 HTTP {}", url, r.status()));
    }
    r.text().await.map_err(|e| e.to_string())
}
