//! E22/E24：实例元数据与实例级设置覆盖。
//!
//! 设计边界：
//! - 每个版本的覆盖与展示元数据放在 versions/<id>/instance-meta.json，不混入 Mojang version json。
//! - 只为启动相关的 Settings 字段提供实例覆盖；账号、默认版本、退出行为仍属全局策略。
//! - isolated=false 时游戏目录与 mods/options/resourcepacks 一起改到 data_dir()/shared-game；
//!   isolated=true（默认）保持现有 versions/<id> 目录，老实例零迁移、零回归。
//! - 所有路径读取都先校验 id：允许 1.20.1 这类带点版本名，但拒绝 /、\ 与 .. 穿越。

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::mc::paths;
use crate::settings::Settings;

const FILE: &str = "instance-meta.json";
static SEQ: AtomicU64 = AtomicU64::new(0);
/// 可由实例覆盖的启动设置；未列出的 Settings 字段一律跟随全局。
pub const OVERRIDE_KEYS: &[&str] = &[
    "memoryMb",
    "javaPath",
    "extraJvmArgs",
    "downloadSource",
    "maxConcurrent",
    "gameLang",
    "quickPlayServer",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InstanceMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub isolated: bool,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub settings: Map<String, Value>,
}

impl Default for InstanceMeta {
    fn default() -> Self {
        Self {
            display_name: None,
            icon: None,
            isolated: true,
            settings: Map::new(),
        }
    }
}

impl InstanceMeta {
    pub fn has_override(&self) -> bool {
        !self.settings.is_empty()
    }

    /// 只把白名单键的覆盖合并进全局设置；最终仍统一走 Settings::sanitize。
    pub fn effective_settings(&self, global: &Settings) -> Result<Settings, String> {
        let mut merged = serde_json::to_value(global).map_err(|e| e.to_string())?;
        let obj = merged
            .as_object_mut()
            .ok_or_else(|| "全局设置格式异常".to_string())?;
        for (k, v) in &self.settings {
            if v.is_null() {
                continue;
            }
            if !OVERRIDE_KEYS.contains(&k.as_str()) {
                return Err(format!("不支持的实例设置字段: {k}"));
            }
            obj.insert(k.clone(), v.clone());
        }
        let mut s: Settings =
            serde_json::from_value(merged).map_err(|e| format!("实例设置格式无效: {e}"))?;
        s.sanitize();
        Ok(s)
    }
}

/// 实例 id 白名单：允许版本名里的点，但绝不参与路径穿越。
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id != "."
        && !id.contains("..")
        && !id.contains('/')
        && !id.contains('\\')
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == 45 || c == 95 || c == 46)
}

fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// tmp → rename 原子提交；Unix 元数据文件 0600。
fn atomic_write(path: &Path, body: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建实例目录失败: {e}"))?;
    }
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "meta".into());
    let tmp = path.with_file_name(format!(".{}.{}.{}.tmp", name, std::process::id(), seq));
    {
        let mut opts = OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        let mut f = opts
            .open(&tmp)
            .map_err(|e| format!("写实例元数据失败: {e}"))?;
        f.write_all(body)
            .map_err(|e| format!("写实例元数据失败: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("同步实例元数据失败: {e}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("收紧实例元数据权限失败: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("提交实例元数据失败: {e}")
    })?;
    Ok(())
}

fn sanitize_meta(m: &mut InstanceMeta) {
    m.settings
        .retain(|k, v| OVERRIDE_KEYS.contains(&k.as_str()) && !v.is_null());
    let clean = |v: &mut Option<String>, max: usize| {
        if let Some(s) = v.as_mut() {
            *s = s.trim().chars().take(max).collect();
            if s.is_empty() {
                *v = None;
            }
        }
    };
    clean(&mut m.display_name, 64);
    clean(&mut m.icon, 32);
}

/// PATCH 语义：缺失字段保持，显式 null 清空 displayName/icon，空对象拒绝。
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MetaPatch {
    #[serde(default, deserialize_with = "double_option")]
    pub display_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub icon: Option<Option<String>>,
    pub isolated: Option<bool>,
}

/// 与数据根目录绑定的存储，单测用独立临时目录，不读写真实用户数据。
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn for_data_dir() -> Self {
        Self {
            root: paths::data_dir(),
        }
    }
    #[cfg(test)]
    fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn version_dir(&self, id: &str) -> PathBuf {
        self.root.join("versions").join(id)
    }
    fn meta_path(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("非法版本 id".into());
        }
        Ok(self.version_dir(id).join(FILE))
    }

    /// 文件不存在或损坏时回退默认元数据，不让 UI 因手改文件而崩。
    pub fn load(&self, id: &str) -> Result<InstanceMeta, String> {
        let p = self.meta_path(id)?;
        let Ok(bytes) = fs::read(&p) else {
            return Ok(InstanceMeta::default());
        };
        let mut m: InstanceMeta = serde_json::from_slice(&bytes).unwrap_or_default();
        sanitize_meta(&mut m);
        Ok(m)
    }

    pub fn save(&self, id: &str, m: &InstanceMeta) -> Result<InstanceMeta, String> {
        let p = self.meta_path(id)?;
        let mut m = m.clone();
        sanitize_meta(&mut m);
        let body =
            serde_json::to_vec_pretty(&m).map_err(|e| format!("序列化实例元数据失败: {e}"))?;
        atomic_write(&p, &body)?;
        Ok(m)
    }

    pub fn patch(&self, id: &str, p: MetaPatch) -> Result<InstanceMeta, String> {
        if p.display_name.is_none() && p.icon.is_none() && p.isolated.is_none() {
            return Err("实例元数据补丁为空".into());
        }
        let mut m = self.load(id)?;
        if let Some(v) = p.display_name {
            m.display_name = v;
        }
        if let Some(v) = p.icon {
            m.icon = v;
        }
        if let Some(v) = p.isolated {
            m.isolated = v;
        }
        self.save(id, &m)
    }

    pub fn settings_of(
        &self,
        id: &str,
        global: &Settings,
    ) -> Result<(Settings, Map<String, Value>), String> {
        let m = self.load(id)?;
        let effective = m.effective_settings(global)?;
        Ok((effective, m.settings))
    }

    /// 把 Partial<Settings> 存成覆盖表；显式 null 删除该覆盖，重新跟随全局。
    pub fn set_override(
        &self,
        id: &str,
        value: &Value,
        global: &Settings,
    ) -> Result<(Settings, Map<String, Value>), String> {
        let Some(obj) = value.as_object() else {
            return Err("实例设置必须是 JSON 对象".into());
        };
        if obj.is_empty() {
            return Err("实例设置为空".into());
        }
        for k in obj.keys() {
            if !OVERRIDE_KEYS.contains(&k.as_str()) {
                return Err(format!("不支持的实例设置字段: {k}"));
            }
        }
        // Partial 语义：只改请求体出现的键；null 删除该覆盖并重新跟随全局。
        // 校验基于「合并后的有效设置」，不能把 null 塞进非 Option 字段。
        let mut m = self.load(id)?;
        for (k, v) in obj {
            if v.is_null() {
                m.settings.remove(k);
            } else {
                m.settings.insert(k.clone(), v.clone());
            }
        }
        m.effective_settings(global)?;
        let m = self.save(id, &m)?;
        let effective = m.effective_settings(global)?;
        Ok((effective, m.settings.clone()))
    }

    pub fn reset_settings(&self, id: &str, global: &Settings) -> Result<Settings, String> {
        let mut m = self.load(id)?;
        m.settings.clear();
        self.save(id, &m)?;
        Ok(global.clone())
    }

    /// 游戏目录：isolated=true 保持 versions/<id>；false 指向共享目录。
    pub fn game_dir(&self, id: &str, m: &InstanceMeta) -> PathBuf {
        // 非法 id 不参与路径拼接；调用方仍需先返回 400，这里是纵深防御。
        if !valid_id(id) {
            return self.root.join("shared-game");
        }
        if m.isolated {
            self.version_dir(id)
        } else {
            self.root.join("shared-game")
        }
    }

    pub fn version_fields(&self, id: &str) -> Value {
        match self.load(id) {
            Ok(m) => {
                json!({ "displayName": m.display_name, "icon": m.icon, "isolated": m.isolated, "hasInstanceSettings": m.has_override() })
            }
            Err(_) => {
                json!({ "displayName": Value::Null, "icon": Value::Null, "isolated": true, "hasInstanceSettings": false })
            }
        }
    }
}

pub fn load(id: &str) -> Result<InstanceMeta, String> {
    Store::for_data_dir().load(id)
}
pub fn save(id: &str, m: &InstanceMeta) -> Result<InstanceMeta, String> {
    Store::for_data_dir().save(id, m)
}
pub fn patch(id: &str, p: MetaPatch) -> Result<InstanceMeta, String> {
    Store::for_data_dir().patch(id, p)
}
pub fn settings_of(id: &str, global: &Settings) -> Result<(Settings, Map<String, Value>), String> {
    Store::for_data_dir().settings_of(id, global)
}
pub fn set_override(
    id: &str,
    value: &Value,
    global: &Settings,
) -> Result<(Settings, Map<String, Value>), String> {
    Store::for_data_dir().set_override(id, value, global)
}
pub fn reset_settings(id: &str, global: &Settings) -> Result<Settings, String> {
    Store::for_data_dir().reset_settings(id, global)
}
pub fn version_fields(id: &str) -> Value {
    Store::for_data_dir().version_fields(id)
}
pub fn game_dir(id: &str, m: &InstanceMeta) -> PathBuf {
    Store::for_data_dir().game_dir(id, m)
}

#[cfg(test)]
mod tests {
    use super::*;
    static N: AtomicU64 = AtomicU64::new(0);
    fn temp(tag: &str) -> (Store, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "lycomc-instance-meta-{}-{}-{}",
            std::process::id(),
            tag,
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("versions").join("demo")).unwrap();
        (Store::new(root.clone()), root)
    }

    #[test]
    fn ids_reject_traversal_but_allow_minecraft_dots() {
        for bad in [
            "",
            ".",
            "..",
            "../settings",
            "a/b",
            "a\\b",
            "a..b",
            "/etc/passwd",
            "空间",
        ] {
            assert!(!valid_id(bad), "{bad}");
        }
        for good in ["1.20.1", "fabric-1.20.1-loader", "a_b-c"] {
            assert!(valid_id(good), "{good}");
        }
    }

    #[test]
    fn effective_settings_only_overrides_whitelisted_keys() {
        let global = Settings {
            memory_mb: 4096,
            quick_play_server: Some("global.example.net:25565".into()),
            ..Settings::default()
        };
        let m = InstanceMeta {
            settings: serde_json::from_value(
                json!({"memoryMb": 10, "downloadSource": "weird", "gameLang": "ZH_CN"}),
            )
            .unwrap(),
            ..InstanceMeta::default()
        };
        let s = m.effective_settings(&global).unwrap();
        assert_eq!(s.memory_mb, 512);
        assert_eq!(s.download_source, "mojang");
        assert_eq!(s.game_lang, "zh_cn");
        assert_eq!(
            s.quick_play_server.as_deref(),
            Some("global.example.net:25565")
        );
        let bad = InstanceMeta {
            settings: serde_json::from_value(json!({"closeOnLaunch": true})).unwrap(),
            ..InstanceMeta::default()
        };
        assert!(bad.effective_settings(&global).is_err());
    }

    #[test]
    fn game_dir_default_is_isolated() {
        let (store, root) = temp("game-dir");
        let m = InstanceMeta::default();
        assert_eq!(store.game_dir("demo", &m), root.join("versions/demo"));
        let shared = InstanceMeta {
            isolated: false,
            ..InstanceMeta::default()
        };
        assert_eq!(store.game_dir("demo", &shared), root.join("shared-game"));
    }

    #[test]
    fn patch_preserves_settings_and_clears_labels() {
        let (store, root) = temp("patch");
        let first = store
            .patch(
                "demo",
                MetaPatch {
                    display_name: Some(Some("我的整合包".into())),
                    icon: Some(Some("grass".into())),
                    isolated: Some(false),
                },
            )
            .unwrap();
        assert_eq!(first.display_name.as_deref(), Some("我的整合包"));
        assert!(!first.isolated);
        let global = Settings::default();
        let saved = store
            .set_override(
                "demo",
                &json!({"memoryMb": 6144, "javaPath": "/opt/java"}),
                &global,
            )
            .unwrap();
        assert_eq!(saved.0.memory_mb, 6144);
        let second = store
            .patch(
                "demo",
                MetaPatch {
                    display_name: Some(None),
                    icon: Some(None),
                    isolated: None,
                },
            )
            .unwrap();
        assert_eq!(second.display_name, None);
        assert_eq!(second.icon, None);
        assert_eq!(second.settings.get("memoryMb"), Some(&json!(6144)));
        assert!(store.patch("demo", MetaPatch::default()).is_err());
        let p = root.join("versions/demo").join(FILE);
        assert!(p.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&p).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn set_override_merges_partial_patch_and_ignores_null_for_non_nullable() {
        let (store, _root) = temp("override-partial");
        let global = Settings::default();
        let (first, o1) = store
            .set_override(
                "demo",
                &json!({"memoryMb": 8192, "gameLang": "en_us"}),
                &global,
            )
            .unwrap();
        assert_eq!(first.memory_mb, 8192);
        assert_eq!(first.game_lang, "en_us");
        assert_eq!(o1.get("memoryMb"), Some(&json!(8192)));
        let (second, o2) = store
            .set_override("demo", &json!({"gameLang": null}), &global)
            .unwrap();
        assert_eq!(second.memory_mb, 8192, "未提交的覆盖键必须保留");
        assert_eq!(
            second.game_lang, global.game_lang,
            "null 删除覆盖并跟随全局"
        );
        assert_eq!(o2.get("memoryMb"), Some(&json!(8192)));
        assert!(!o2.contains_key("gameLang"));
        let (reset, empty) = (
            store.reset_settings("demo", &global).unwrap(),
            store.load("demo").unwrap().settings,
        );
        assert_eq!(reset.memory_mb, global.memory_mb);
        assert!(empty.is_empty());
    }

    #[test]
    fn set_override_rejects_bad_payload_and_null_removes_key() {
        let (store, _root) = temp("override");
        let global = Settings::default();
        assert!(store.set_override("demo", &json!([]), &global).is_err());
        assert!(store.set_override("demo", &json!({}), &global).is_err());
        assert!(store
            .set_override("demo", &json!({"memoryMb": "many"}), &global)
            .is_err());
        assert!(store
            .set_override("demo", &json!({"closeOnLaunch": true}), &global)
            .is_err());
        assert!(store
            .set_override("../escape", &json!({"memoryMb": 8192}), &global)
            .is_err());
        let (s, o) = store
            .set_override(
                "demo",
                &json!({"memoryMb": 8192, "javaPath": null}),
                &global,
            )
            .unwrap();
        assert_eq!(s.memory_mb, 8192);
        assert_eq!(s.java_path, None);
        assert!(!o.contains_key("javaPath"));
        assert!(o.contains_key("memoryMb"));
        let (reset, empty) = (
            store.reset_settings("demo", &global).unwrap(),
            store.load("demo").unwrap().settings,
        );
        assert_eq!(reset.memory_mb, 4096);
        assert!(empty.is_empty());
    }
}
