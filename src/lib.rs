//! lycomc 内核：浏览器、CLI、TUI、MCP 共用；桌面壳只在 desktop feature 下编译。
//! Android 通过 cdylib + JNI 复用同一份 axum 服务。

pub mod api;
pub mod assets;
pub mod commands;
pub mod jobs;
pub mod mc;
pub mod policy;
pub mod settings;

// Web 优先：默认构建完全不编译 wry / tao / tray-icon，也不链接系统 WebView。
#[cfg(all(
    feature = "desktop",
    any(target_os = "linux", target_os = "windows", target_os = "macos")
))]
pub mod desktop;

/// 给 Android WebView 壳调用：在进程内启动本地服务，返回实际监听端口。
/// 端口完全由内核分配，调用方只需拼成普通 URL，不需要让用户看到端口概念。
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_app_lilycraft_launcher_MainActivity_nativeStart(
    _env: jni::JNIEnv<'_>,
    _class: jni::objects::JClass<'_>,
) -> i32 {
    api::start_embedded() as i32
}
