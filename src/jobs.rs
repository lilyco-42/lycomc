//! 任务表：安装 / 启动 / 装模组都是长操作，统一成任务。
//!
//! 内存里存一份任务快照 + 一条 broadcast 频道；/api/events 把所有任务变化推给前端，
//! 前端按 id 过滤即可。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::mc::{Progress, ProgressFn};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Running,
    Done,
    Error,
}

impl State {
    pub fn is_active(self) -> bool {
        self == State::Running
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    /// install | launch | mods
    pub kind: String,
    pub title: String,
    pub state: State,
    /// 0-100
    pub progress: f64,
    pub message: String,
    pub logs: Vec<String>,
    pub result: Option<serde_json::Value>,
    /// 毫秒时间戳
    pub created_at: u64,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Clone)]
pub struct JobStore {
    inner: Arc<Mutex<HashMap<String, Job>>>,
    tx: broadcast::Sender<Job>,
    seq: Arc<AtomicU64>,
}

impl Default for JobStore {
    fn default() -> Self {
        Self::new()
    }
}

impl JobStore {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(1024);
        Self { inner: Arc::new(Mutex::new(HashMap::new())), tx, seq: Arc::new(AtomicU64::new(0)) }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Job> {
        self.tx.subscribe()
    }

    pub fn create(&self, kind: &str, title: impl Into<String>) -> String {
        let n = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let id = format!("j{}-{}", now_ms(), n);
        let job = Job {
            id: id.clone(),
            kind: kind.to_string(),
            title: title.into(),
            state: State::Running,
            progress: 0.0,
            message: "排队中…".into(),
            logs: Vec::new(),
            result: None,
            created_at: now_ms(),
        };
        if let Ok(mut m) = self.inner.lock() {
            m.insert(id.clone(), job.clone());
        }
        let _ = self.tx.send(job);
        id
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.inner.lock().ok()?.get(id).cloned()
    }

    pub fn list(&self) -> Vec<Job> {
        let mut v: Vec<Job> =
            self.inner.lock().map(|m| m.values().cloned().collect()).unwrap_or_default();
        v.sort_by(|a, b| {
            let ra = u8::from(!a.state.is_active());
            let rb = u8::from(!b.state.is_active());
            ra.cmp(&rb).then(b.created_at.cmp(&a.created_at))
        });
        v
    }

    pub fn active(&self) -> Vec<Job> {
        self.list().into_iter().filter(|j| j.state.is_active()).collect()
    }

    fn mutate<F: FnOnce(&mut Job)>(&self, id: &str, f: F) {
        let snapshot = {
            let Ok(mut m) = self.inner.lock() else { return };
            let Some(job) = m.get_mut(id) else { return };
            f(job);
            job.clone()
        };
        let _ = self.tx.send(snapshot);
    }

    /// 内核的进度回调 -> 任务快照更新。内核线程同步调用，这里只做内存写。
    pub fn sink(&self, id: &str) -> impl Fn(Progress) + Send + Sync + 'static {
        let store = self.clone();
        let id = id.to_string();
        move |p: Progress| {
            store.mutate(&id, |job| {
                job.progress = p.percent.clamp(0.0, 100.0);
                job.message = p.message.clone();
                if let Some(line) = &p.log {
                    push_log(&mut job.logs, line.clone());
                }
            });
        }
    }

    pub fn done(&self, id: &str, result: serde_json::Value) {
        self.mutate(id, |job| {
            job.state = State::Done;
            job.progress = 100.0;
            job.message = "完成".into();
            job.result = Some(result);
        });
    }

    pub fn fail(&self, id: &str, err: impl Into<String>) {
        let msg = err.into();
        let shown = msg.clone();
        self.mutate(id, |job| {
            job.state = State::Error;
            job.message = msg.clone();
            job.result = Some(serde_json::json!({ "error": msg }));
            let line = format!("错误: {msg}");
            push_log(&mut job.logs, line);
        });
        let _ = shown;
    }

    pub fn log(&self, id: &str, line: impl Into<String>) {
        let line = line.into();
        let shown = line.clone();
        self.mutate(id, |job| {
            job.message = shown;
            push_log(&mut job.logs, line);
        });
    }
}

const MAX_LOGS: usize = 400;

fn push_log(logs: &mut Vec<String>, line: String) {
    logs.push(line);
    if logs.len() > MAX_LOGS {
        let drop_n = logs.len() - MAX_LOGS;
        logs.drain(0..drop_n);
    }
}

/// 借一个 Box 版进度回调给需要 'static 的场景（spawn 出去的异步任务里）。
pub fn boxed_sink(store: &JobStore, id: &str) -> Arc<dyn Fn(Progress) + Send + Sync> {
    Arc::new(store.sink(id))
}
