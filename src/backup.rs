//! H35：设置导入导出、本地备份与缓存清理。
//!
//! 设计边界：
//! - 备份文件只保存 settings.json 与 accounts.json 的快照，不复制版本、库、资源。
//! - accounts.json 含凭据，备份文件在 Unix 下强制 0600；任何 HTTP 响应都不返回备份正文。
//! - 清理只递归删除 data_dir()/cache 下的条目，不触碰 settings/accounts/versions 等。
//! - 备份 id 仅允许 ASCII 字母数字与连字符下划线，从根上拒绝路径穿越。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::settings::Settings;

const FORMAT: &str = "lycomc-backup-v1";
static SEQ: AtomicU64 = AtomicU64::new(0);

pub fn backups_dir() -> PathBuf {
    crate::mc::paths::data_dir().join("backups")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub file_name: String,
    pub bytes: u64,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub freed_bytes: u64,
    pub removed_files: u64,
    pub removed_dirs: u64,
}

#[derive(Serialize, Deserialize)]
struct BackupArchive {
    format: String,
    #[serde(rename = "createdAt")]
    created_at: u64,
    settings: Settings,
    accounts: Value,
}

/// 备份 id 白名单：不含路径分隔符与点，绝不参与路径拼接。
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        // 45 对应连字符，95 对应下划线。
        && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == 45 || c == 95)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// tmp → rename 原子提交；secret=true 时 Unix 权限收紧到 0600。
fn atomic_write(path: &Path, body: &[u8], secret: bool) -> Result<(), String> {
    #[cfg(not(unix))]
    {
        let _ = secret;
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "data".into());
    let tmp = path.with_file_name(format!(".{}.{}.{}.tmp", name, std::process::id(), seq));
    {
        let mut opts = OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        let mut f = opts
            .open(&tmp)
            .map_err(|e| format!("写临时文件失败: {e}"))?;
        f.write_all(body).map_err(|e| format!("写入失败: {e}"))?;
        f.sync_all().map_err(|e| format!("同步失败: {e}"))?;
    }
    #[cfg(unix)]
    {
        if secret {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("收紧备份权限失败: {e}"))?;
        }
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("提交文件失败: {e}")
    })?;
    Ok(())
}

fn read_settings(path: &Path) -> Settings {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
        .unwrap_or_default()
}

/// 不跟随符号链接地统计目录大小，避免清理时越界。
fn dir_size(path: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    for ent in fs::read_dir(path).map_err(|e| format!("遍历缓存目录失败: {e}"))? {
        let ent = ent.map_err(|e| format!("遍历缓存目录失败: {e}"))?;
        let ft = ent
            .file_type()
            .map_err(|e| format!("读取缓存类型失败: {e}"))?;
        if ft.is_dir() {
            total += dir_size(&ent.path())?;
        } else {
            total += fs::symlink_metadata(ent.path())
                .map(|m| m.len())
                .unwrap_or(0);
        }
    }
    Ok(total)
}

/// 与数据根目录绑定的存储，方便单测用独立临时目录，不读写真实用户数据。
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn for_data_dir() -> Self {
        Self {
            root: crate::mc::paths::data_dir(),
        }
    }

    #[cfg(test)]
    fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn backups(&self) -> PathBuf {
        self.root.join("backups")
    }
    fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    fn accounts_file(&self) -> PathBuf {
        self.root.join("accounts.json")
    }
    fn cache_dir(&self) -> PathBuf {
        self.root.join("cache")
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("非法备份 id".into());
        }
        Ok(self.backups().join(format!("{}.json", id)))
    }

    pub fn create(&self) -> Result<BackupEntry, String> {
        fs::create_dir_all(self.backups()).map_err(|e| format!("创建备份目录失败: {e}"))?;
        let mut settings = read_settings(&self.settings_file());
        settings.sanitize();
        let accounts: Value = fs::read(self.accounts_file())
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .unwrap_or_else(|| Value::Array(Vec::new()));
        let created_at = now_ms();
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let id = format!("backup-{}-{}-{}", created_at, nanos, seq);
        let file_name = format!("{}.json", id);
        let path = self.backups().join(&file_name);
        let archive = BackupArchive {
            format: FORMAT.into(),
            created_at,
            settings,
            accounts,
        };
        let body =
            serde_json::to_vec_pretty(&archive).map_err(|e| format!("序列化备份失败: {e}"))?;
        atomic_write(&path, &body, true)?;
        Ok(BackupEntry {
            id,
            file_name,
            bytes: body.len() as u64,
            created_at,
        })
    }

    pub fn list(&self) -> Result<Vec<BackupEntry>, String> {
        let dir = self.backups();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut items = Vec::new();
        for ent in fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {e}"))? {
            let ent = ent.map_err(|e| format!("读取备份条目失败: {e}"))?;
            let name = ent.file_name().to_string_lossy().to_string();
            let Some(raw_id) = name.strip_suffix(".json") else {
                continue;
            };
            if !valid_id(raw_id) {
                continue;
            }
            let id = raw_id.to_string();
            let meta = ent
                .metadata()
                .map_err(|e| format!("读取备份信息失败: {e}"))?;
            if !meta.is_file() {
                continue;
            }
            let created_at = fs::read(ent.path())
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|v| v.get("createdAt").and_then(|x| x.as_u64()))
                .unwrap_or_else(|| mtime_ms(&meta));
            items.push(BackupEntry {
                id,
                file_name: name,
                bytes: meta.len(),
                created_at,
            });
        }
        items.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(items)
    }

    pub fn restore(&self, id: &str) -> Result<Settings, String> {
        let path = self.path_for(id)?;
        let body = fs::read(&path).map_err(|_| format!("备份 {id} 不存在"))?;
        let archive: BackupArchive =
            serde_json::from_slice(&body).map_err(|e| format!("备份格式损坏: {e}"))?;
        if archive.format != FORMAT {
            return Err("不支持的备份格式".into());
        }
        let mut settings = archive.settings;
        settings.sanitize();
        let settings_body =
            serde_json::to_vec_pretty(&settings).map_err(|e| format!("序列化设置失败: {e}"))?;
        atomic_write(&self.settings_file(), &settings_body, false)?;
        let accounts_body = serde_json::to_vec_pretty(&archive.accounts)
            .map_err(|e| format!("序列化账号失败: {e}"))?;
        atomic_write(&self.accounts_file(), &accounts_body, true)?;
        Ok(settings)
    }

    pub fn cleanup(&self) -> Result<CleanupReport, String> {
        let dir = self.cache_dir();
        let mut report = CleanupReport {
            freed_bytes: 0,
            removed_files: 0,
            removed_dirs: 0,
        };
        if !dir.exists() {
            return Ok(report);
        }
        for ent in fs::read_dir(&dir).map_err(|e| format!("读取缓存目录失败: {e}"))? {
            let ent = ent.map_err(|e| format!("读取缓存条目失败: {e}"))?;
            let path = ent.path();
            let ft = ent
                .file_type()
                .map_err(|e| format!("读取缓存类型失败: {e}"))?;
            if ft.is_symlink() {
                let size = fs::symlink_metadata(&path).map(|m| m.len()).unwrap_or(0);
                match fs::remove_file(&path) {
                    Ok(()) => {}
                    Err(_) => {
                        fs::remove_dir(&path).map_err(|e| format!("删除缓存链接失败: {e}"))?
                    }
                }
                report.freed_bytes += size;
                report.removed_files += 1;
            } else if ft.is_dir() {
                report.freed_bytes += dir_size(&path)?;
                fs::remove_dir_all(&path).map_err(|e| format!("删除缓存目录失败: {e}"))?;
                report.removed_dirs += 1;
            } else {
                let size = ent.metadata().map(|m| m.len()).unwrap_or(0);
                fs::remove_file(&path).map_err(|e| format!("删除缓存文件失败: {e}"))?;
                report.freed_bytes += size;
                report.removed_files += 1;
            }
        }
        Ok(report)
    }
}

pub fn create() -> Result<BackupEntry, String> {
    Store::for_data_dir().create()
}
pub fn list() -> Result<Vec<BackupEntry>, String> {
    Store::for_data_dir().list()
}
pub fn restore(id: &str) -> Result<Settings, String> {
    Store::for_data_dir().restore(id)
}
pub fn cleanup() -> Result<CleanupReport, String> {
    Store::for_data_dir().cleanup()
}

/// 导入设置：把 JSON 对象的键浅合并进当前设置，再统一 sanitize。
/// 缺省字段保持原值，显式 null 清空可空字段；非法类型与空对象直接拒绝。
pub fn merge_settings(current: &Settings, value: &Value) -> Result<Settings, String> {
    let Some(patch) = value.as_object() else {
        return Err("导入内容必须是 JSON 对象".into());
    };
    if patch.is_empty() {
        return Err("导入内容为空".into());
    }
    let mut merged = serde_json::to_value(current).map_err(|e| format!("读取当前设置失败: {e}"))?;
    let obj = merged
        .as_object_mut()
        .ok_or_else(|| "当前设置格式异常".to_string())?;
    for (k, v) in patch {
        obj.insert(k.clone(), v.clone());
    }
    let mut s: Settings =
        serde_json::from_value(merged).map_err(|e| format!("导入设置格式无效: {e}"))?;
    s.sanitize();
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!(
            "lycomc-backup-test-{}-{}-{}",
            std::process::id(),
            tag,
            n
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn import_keeps_missing_fields_and_sanitizes_values() {
        let cur = Settings {
            memory_mb: 8192,
            quick_play_server: Some("keep.example.net:25565".into()),
            ..Settings::default()
        };
        let v = serde_json::json!({"memoryMb": 10, "downloadSource": "weird", "gameLang": "ZH_CN"});
        let s = merge_settings(&cur, &v).unwrap();
        assert_eq!(s.memory_mb, 512);
        assert_eq!(s.download_source, "mojang");
        assert_eq!(s.game_lang, "zh_cn");
        assert_eq!(
            s.quick_play_server.as_deref(),
            Some("keep.example.net:25565")
        );
        assert_eq!(s.max_concurrent, cur.max_concurrent);
    }

    #[test]
    fn import_rejects_non_object_empty_and_bad_type() {
        let cur = Settings::default();
        assert!(merge_settings(&cur, &serde_json::json!([])).is_err());
        assert!(merge_settings(&cur, &serde_json::json!({})).is_err());
        assert!(merge_settings(&cur, &serde_json::json!({"memoryMb": "many"})).is_err());
        assert!(merge_settings(&cur, &serde_json::json!(42)).is_err());
    }

    #[test]
    fn import_explicit_null_clears_nullable_fields() {
        let cur = Settings {
            java_path: Some("/usr/bin/java".into()),
            quick_play_server: Some("srv.example.net:25565".into()),
            ..Settings::default()
        };
        let v = serde_json::json!({"javaPath": null, "quickPlayServer": null});
        let s = merge_settings(&cur, &v).unwrap();
        assert_eq!(s.java_path, None);
        assert_eq!(s.quick_play_server, None);
        assert_eq!(s.memory_mb, cur.memory_mb);
    }

    #[test]
    fn create_list_restore_roundtrip_and_cleanup_boundary() {
        let root = temp_root("roundtrip");
        let store = Store::new(root.clone());
        let s = Settings {
            memory_mb: 6144,
            quick_play_server: Some("srv.example.net:25565".into()),
            ..Settings::default()
        };
        let sb = serde_json::to_vec_pretty(&s).unwrap();
        atomic_write(&store.settings_file(), &sb, false).unwrap();
        let accounts = serde_json::json!([{"name": "Tester", "refreshToken": "secret", "accessToken": "secret2"}]);
        let ab = serde_json::to_vec_pretty(&accounts).unwrap();
        atomic_write(&store.accounts_file(), &ab, true).unwrap();

        let entry = store.create().unwrap();
        assert!(entry.id.starts_with("backup-"));
        assert!(entry.bytes > 0);
        assert!(entry.created_at > 0);
        let entry_json = serde_json::to_string(&entry).unwrap();
        assert!(!entry_json.contains("secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let p = store.backups().join(&entry.file_name);
            let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        let items = store.list().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, entry.id);
        assert_eq!(items[0].file_name, entry.file_name);
        assert!(!serde_json::to_string(&items).unwrap().contains("secret"));

        let mut changed = s.clone();
        changed.memory_mb = 1024;
        atomic_write(
            &store.settings_file(),
            &serde_json::to_vec_pretty(&changed).unwrap(),
            false,
        )
        .unwrap();
        let restored = store.restore(&entry.id).unwrap();
        assert_eq!(restored.memory_mb, 6144);
        let back: Value =
            serde_json::from_slice(&fs::read(store.accounts_file()).unwrap()).unwrap();
        assert_eq!(back[0]["refreshToken"], "secret");

        fs::create_dir_all(store.cache_dir().join("nested")).unwrap();
        fs::write(store.cache_dir().join("a.bin"), vec![7u8; 128]).unwrap();
        fs::write(store.cache_dir().join("nested/b.bin"), vec![9u8; 64]).unwrap();
        fs::write(store.settings_file(), b"protected").unwrap();
        let report = store.cleanup().unwrap();
        assert_eq!(report.removed_files, 1);
        assert_eq!(report.removed_dirs, 1);
        assert_eq!(report.freed_bytes, 192);
        assert!(store.cache_dir().exists());
        assert!(!store.cache_dir().join("a.bin").exists());
        assert!(fs::read_dir(store.cache_dir()).unwrap().next().is_none());
        assert_eq!(fs::read(store.settings_file()).unwrap(), b"protected");
        assert!(store.accounts_file().exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_rejects_path_traversal_ids() {
        let root = temp_root("traversal");
        let store = Store::new(root.clone());
        for id in ["..", "../settings", "/etc/passwd", "a/b", "a.b", ""] {
            assert!(store.restore(id).is_err(), "id should be rejected: {}", id);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_ignores_unrelated_files_and_cleanup_without_cache_is_zero() {
        let root = temp_root("misc");
        let store = Store::new(root.clone());
        fs::create_dir_all(store.backups()).unwrap();
        fs::write(store.backups().join("notes.txt"), b"hello").unwrap();
        fs::write(store.backups().join("../escape.json"), b"{}").unwrap();
        fs::write(store.backups().join("evil.json"), b"not json").unwrap();
        // 合法 id 但格式损坏的备份也会列出元数据（bytes + mtime），这是管理页所需的可见性；
        // 真正恢复时 BackupArchive 解析失败会 4xx。此处只验证无关文件与非法 id 完全不出现。
        let items = store.list().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "evil");
        assert_eq!(items[0].bytes, 8);
        let report = store.cleanup().unwrap();
        assert_eq!(report.freed_bytes, 0);
        assert_eq!(report.removed_files, 0);
        assert_eq!(report.removed_dirs, 0);
        let _ = fs::remove_dir_all(&root);
    }
}
