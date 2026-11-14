//! 目录约定。全部可用 LYCOMC_DATA_DIR 覆盖，便于测试与多实例。

use std::path::PathBuf;

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

pub fn data_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("LYCOMC_DATA_DIR") {
        return PathBuf::from(p);
    }
    directories::ProjectDirs::from("", "", "lycomc")
        .map(|p| p.data_dir().to_path_buf())
        .unwrap_or_else(|| home_dir().join(".local/share/lycomc"))
}

pub fn versions_dir() -> PathBuf {
    data_dir().join("versions")
}
pub fn version_dir(id: &str) -> PathBuf {
    versions_dir().join(id)
}
pub fn libraries_dir() -> PathBuf {
    data_dir().join("libraries")
}
pub fn assets_dir() -> PathBuf {
    data_dir().join("assets")
}
pub fn indexes_dir() -> PathBuf {
    assets_dir().join("indexes")
}
pub fn objects_dir() -> PathBuf {
    assets_dir().join("objects")
}
pub fn java_dir() -> PathBuf {
    data_dir().join("java")
}
pub fn logs_dir() -> PathBuf {
    data_dir().join("logs")
}
pub fn settings_file() -> PathBuf {
    data_dir().join("settings.json")
}
pub fn accounts_file() -> PathBuf {
    data_dir().join("accounts.json")
}
/// 元数据缓存（版本清单 / version json / fabric json），避免每次重下
pub fn cache_dir() -> PathBuf {
    data_dir().join("cache")
}

pub fn ensure_all() -> std::io::Result<()> {
    for d in [
        versions_dir(),
        libraries_dir(),
        indexes_dir(),
        objects_dir(),
        java_dir(),
        logs_dir(),
        cache_dir(),
    ] {
        std::fs::create_dir_all(d)?;
    }
    Ok(())
}
