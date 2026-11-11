//! 持久化配置与账号（~/.local/share/lycomc/settings.json、accounts.json）

use serde::{Deserialize, Serialize};

use crate::mc::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 分配给游戏堆的内存（MB）
    pub memory_mb: u32,
    /// 手动指定的 java 可执行文件；None = 自动探测/自动下载
    pub java_path: Option<String>,
    /// 追加的 JVM 参数
    pub extra_jvm_args: Vec<String>,
    /// 主页默认选中的实例
    pub select_version: Option<String>,
    /// 下载源：mojang = 官方，bmcl = 国内镜像
    pub download_source: String,
    /// 同时下载文件数
    pub max_concurrent: usize,
    /// 启动游戏后是否关掉启动器
    pub close_on_launch: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            memory_mb: 4096,
            java_path: None,
            extra_jvm_args: Vec::new(),
            select_version: None,
            download_source: "mojang".into(),
            max_concurrent: 16,
            close_on_launch: false,
        }
    }
}

impl Settings {
    /// 把明显不合理的字段拉回可用范围（用户手改 json 也不至于崩）
    pub fn sanitize(&mut self) {
        if self.memory_mb < 256 {
            self.memory_mb = 512;
        }
        if self.memory_mb > 65536 {
            self.memory_mb = 65536;
        }
        if self.max_concurrent == 0 {
            self.max_concurrent = 1;
        }
        if self.max_concurrent > 64 {
            self.max_concurrent = 64;
        }
        if !matches!(self.download_source.as_str(), "mojang" | "bmcl") {
            self.download_source = "mojang".into();
        }
        if self.java_path.as_deref().is_some_and(|v| v.trim().is_empty()) {
            self.java_path = None;
        }
        if self.select_version.as_deref().is_some_and(|v| v.trim().is_empty()) {
            self.select_version = None;
        }
        self.extra_jvm_args.retain(|a| !a.trim().is_empty());
    }

    pub fn source(&self) -> crate::mc::meta::Source {
        match self.download_source.as_str() {
            "bmcl" => crate::mc::meta::Source::Bmcl,
            _ => crate::mc::meta::Source::Mojang,
        }
    }
}

/// 读配置；文件缺失或损坏都退回默认值
pub fn load() -> Settings {
    let mut s = std::fs::read_to_string(paths::settings_file())
        .ok()
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok())
        .unwrap_or_default();
    s.sanitize();
    s
}

pub fn save(s: &Settings) -> Result<Settings, String> {
    let mut s = s.clone();
    s.sanitize();
    let p = paths::settings_file();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let body = serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("写配置失败: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("提交配置失败: {e}"))?;
    Ok(s)
}

// ── 账号 ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub uuid: String,
    /// 目前只做离线登录
    pub kind: String,
}

/// 离线账号名限制：Minecraft 用户名 3–16 位字母数字下划线
pub fn valid_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.len() < 3 || n.len() > 16 {
        return Err("用户名需 3–16 个字符".into());
    }
    if !n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("用户名只能包含字母、数字和下划线".into());
    }
    Ok(())
}

pub fn load_accounts() -> Vec<Account> {
    std::fs::read_to_string(paths::accounts_file())
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<Account>>(&t).ok())
        .map(|mut v| {
            // uuid 由名字推导，老文件里缺了就补上
            for a in v.iter_mut() {
                if a.uuid.trim().is_empty() {
                    a.uuid = crate::mc::offline_uuid(&a.name);
                }
                if a.kind.trim().is_empty() {
                    a.kind = "offline".into();
                }
            }
            v
        })
        .unwrap_or_default()
}

pub fn save_accounts(list: &[Account]) -> Result<(), String> {
    let p = paths::accounts_file();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let body = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("写账号失败: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("提交账号失败: {e}"))?;
    Ok(())
}

pub fn add_account(name: &str) -> Result<Account, String> {
    valid_name(name)?;
    let n = name.trim().to_string();
    let mut list = load_accounts();
    if list.iter().any(|a| a.name.eq_ignore_ascii_case(&n)) {
        return Err(format!("账号 {n} 已存在"));
    }
    let acc = Account { uuid: crate::mc::offline_uuid(&n), name: n, kind: "offline".into() };
    list.push(acc.clone());
    save_accounts(&list)?;
    Ok(acc)
}

pub fn remove_account(name: &str) -> Result<(), String> {
    let mut list = load_accounts();
    let before = list.len();
    list.retain(|a| a.name != name);
    if list.len() == before {
        return Err(format!("账号 {name} 不存在"));
    }
    save_accounts(&list)
}

pub fn find_account(name: &str) -> Option<Account> {
    load_accounts().into_iter().find(|a| a.name == name)
}
