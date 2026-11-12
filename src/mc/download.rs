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
    let part_size = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    Err(format!(
        "下载 {} 失败（已保存 {:.1} MB 可续传）: {last_err}",
        it.dest.display(),
        part_size as f64 / 1_048_576.0
    ))
}

/// 下载到 `.part`，支持断点续传。
///
/// 国内链路实测只有 ~250 KB/s，41 MB 的 client.jar 要 165 s；中途一次抖动就必须能续上，
/// 否则每个大文件都会变成「重下 + 再断」的死循环。这里用 Range 请求从已有字节继续，
/// 服务器若不支持 Range（回 200）则从头写。返回最终完整字节数。
async fn stream_to(
    c: &reqwest::Client,
    url: &str,
    part: &Path,
    done: &Arc<AtomicU64>,
) -> Result<u64, String> {
    use tokio::io::AsyncSeekExt;

    let have = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    let mut req = c.get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    // 206 = 服务器接受了续传；200 = 忽略 Range，必须从头覆盖写
    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT && have > 0;
    if resumed {
        // 已有字节也要计入本次进度，否则续传的文件永远显示不到 100%
        done.fetch_add(have, Ordering::Relaxed);
    }
    let mut n = if resumed { have } else { 0u64 };
    let mut f = if resumed {
        let mut f = tokio::fs::OpenOptions::new()
            .append(true)
            .open(part)
            .await
            .map_err(|e| e.to_string())?;
        f.seek(std::io::SeekFrom::End(0)).await.ok();
        f
    } else {
        tokio::fs::File::create(part).await.map_err(|e| e.to_string())?
    };
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        f.write_all(&chunk).await.map_err(|e| e.to_string())?;
        n += chunk.len() as u64;
        done.fetch_add(chunk.len() as u64, Ordering::Relaxed);
    }
    f.flush().await.map_err(|e| e.to_string())?;
    f.sync_all().await.map_err(|e| e.to_string())?;
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


#[cfg(test)]
mod resume_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// 起一个只服务一次的极简 HTTP 服务：支持 Range 就回 206，否则回 200 全量
    fn serve_once(payload: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { continue };
                let mut buf = [0u8; 2048];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                let start = req
                    .split("range: bytes=")
                    .nth(1)
                    .and_then(|t| t.split('-').next())
                    .and_then(|t| t.trim().parse::<usize>().ok());
                match start {
                    Some(from) if from < payload.len() => {
                        let body = &payload[from..];
                        let head = format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                            body.len(),
                            from,
                            payload.len() - 1,
                            payload.len()
                        );
                        let _ = s.write_all(head.as_bytes());
                        let _ = s.write_all(body);
                    }
                    _ => {
                        let head = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            payload.len()
                        );
                        let _ = s.write_all(head.as_bytes());
                        let _ = s.write_all(payload);
                    }
                }
                let _ = s.flush();
            }
        });
        format!("http://{addr}/client.jar")
    }

    static BODY: &[u8] = b"0123456789ABCDEF0123456789ABCDEF";

    #[tokio::test]
    async fn resumes_from_existing_part_file() {
        let url = serve_once(BODY);
        let dir = std::env::temp_dir().join(format!("lycomc-resume-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let part = dir.join("f.jar.part");
        // 本地已有前 10 字节，模拟上次被超时截断
        std::fs::write(&part, &BODY[..10]).unwrap();
        let done = Arc::new(AtomicU64::new(0));
        let n = stream_to(&meta::client(), &url, &part, &done).await.unwrap();
        assert_eq!(n as usize, BODY.len(), "续传后字节数应等于完整长度");
        assert_eq!(std::fs::read(&part).unwrap(), BODY, "续传内容必须完整且不重复");
        assert_eq!(done.load(Ordering::Relaxed) as usize, BODY.len(), "进度应计入已续传字节");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn restarts_when_server_ignores_range() {
        // 服务器忽略 Range 时必须从头覆盖，不能把新内容追加到旧字节后面
        static SMALL: &[u8] = b"ABCDEF";
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = s.read(&mut buf);
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    SMALL.len()
                );
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(SMALL);
                let _ = s.flush();
            }
        });
        let dir = std::env::temp_dir().join(format!("lycomc-norange-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let part = dir.join("g.jar.part");
        std::fs::write(&part, b"stale").unwrap();
        let done = Arc::new(AtomicU64::new(0));
        let n = stream_to(&meta::client(), &format!("http://{addr}/g.jar"), &part, &done)
            .await
            .unwrap();
        assert_eq!(n as usize, SMALL.len());
        assert_eq!(std::fs::read(&part).unwrap(), SMALL);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
