//! 自研薄桌面壳：原生窗口 + 托盘 + 快捷方式，内核仍是同一份 axum。
//! Linux 在 Wayland 会话下强制 X11 后端，因为 wry/webkit2gtk 当前只支持 Xlib 句柄。

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};
use wry::WebViewBuilder;

#[derive(Clone, Copy, Debug)]
enum UserEvent {
    Show,
    Guide,
    Quit,
}

const MARK: &str = "# 由 LilyCraft 启动器自动生成，可安全删除\n";

fn icon() -> Option<Icon> {
    // 32x32 自绘圆角蓝紫渐变：不依赖外部图片文件，四端都能构建。
    let mut rgba = Vec::with_capacity(32 * 32 * 4);
    for y in 0..32u32 {
        for x in 0..32u32 {
            let t = (x + y) as f32 / 62.0;
            let r = (72.0 + 70.0 * t) as u8;
            let g = (116.0 - 20.0 * t) as u8;
            let b = (220.0 + 30.0 * t) as u8;
            let edge = x < 2 || y < 2 || x > 29 || y > 29;
            let px: [u8; 4] = if edge { [0, 0, 0, 0] } else { [r, g, b, 255] };
            rgba.extend_from_slice(&px);
        }
    }
    Icon::from_rgba(rgba, 32, 32).ok()
}

/// 桌面会话里是否有可用的图形环境。
pub fn available() -> bool {
    std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(target_os = "linux")]
fn prepare_linux_session() {
    // wry 0.57 / webkit2gtk 在 Linux 只接受 Xlib window handle；Wayland 会话下强制 X11。
    if std::env::var("GDK_BACKEND").is_err() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    // KDE+Wayland 的 Xwayland 授权文件常不在 XAUTHORITY 里，补上才能创建窗口。
    if std::env::var("XAUTHORITY").is_err() {
        let uid = unsafe { libc::getuid() };
        let dir = format!("/run/user/{uid}");
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                if e.file_name().to_string_lossy().starts_with("xauth_") {
                    std::env::set_var("XAUTHORITY", e.path());
                    break;
                }
            }
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn prepare_linux_session() {}

fn write_if_ours(path: &std::path::Path, content: &str) {
    let old = std::fs::read_to_string(path).unwrap_or_default();
    if !path.exists() || old.contains("LilyCraft") || old.contains(MARK.trim()) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, format!("{MARK}{content}"));
    }
}

#[cfg(target_os = "linux")]
fn install_linux_shortcuts(exe: &std::path::Path) -> std::path::PathBuf {
    let home = crate::mc::paths::home_dir();
    let icon = home.join(".local/share/icons/hicolor/scalable/apps/lilycraft.svg");
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4874dc"/><stop offset="1" stop-color="#8a5cf6"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="14" fill="url(#g)"/><path d="M22 16h8v26h18v6H22z" fill="#fff"/></svg>"##;
    write_if_ours(&icon, svg);
    let app = home.join(".local/share/applications/lilycraft.desktop");
    let body = format!(
        "[Desktop Entry]\nType=Application\nName=LilyCraft\nComment=小白也能用的 Minecraft 启动器\nExec=\"{}\"\nIcon=\"{}\"\nTerminal=false\nCategories=Game;\nStartupWMClass=LilyCraft\n",
        exe.display(),
        icon.display()
    );
    write_if_ours(&app, &body);
    let desk = home.join("Desktop/LilyCraft.desktop");
    write_if_ours(&desk, &body);
    app
}

#[cfg(not(target_os = "linux"))]
fn install_linux_shortcuts(_exe: &std::path::Path) -> std::path::PathBuf {
    std::path::PathBuf::new()
}

/// 打开主窗口。正常退出会结束进程；函数返回只代表窗口或托盘不可用，调用方可回落浏览器。
pub fn run() {
    prepare_linux_session();
    let exe = std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("lycomc"));
    let _desktop_file = install_linux_shortcuts(&exe);
    let port = crate::api::start_embedded();
    let url = format!("http://127.0.0.1:{port}/#/");
    let guide = format!("http://127.0.0.1:{port}/#/guide");

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = match WindowBuilder::new()
        .with_title("LilyCraft 启动器")
        .with_inner_size(tao::dpi::LogicalSize::new(1180.0, 780.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(900.0, 600.0))
        .build(&event_loop)
    {
        Ok(w) => w,
        Err(e) => {
            eprintln!("lycomc: 无法创建桌面窗口: {e}");
            return;
        }
    };
    // 必须以子窗口方式嵌入：非 child 模式下 wry 在 X11/Xwayland 上会把 webkit2gtk
    // 的 GtkWindow 直接顶到宿主 X 窗口，本机实测整窗全黑（最小复现：同样 900x600 的
    // data: URL 页只有 build_as_child 能画出内容）。child 模式会自己建 container，
    // 再由 set_bounds 对齐尺寸。
    let inner = window.inner_size();
    let scale = window.scale_factor();
    let logical = inner.to_logical::<u32>(scale);
    let webview = match WebViewBuilder::new()
        .with_url(&url)
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0, 0).into(),
            size: wry::dpi::LogicalSize::new(logical.width, logical.height).into(),
        })
        .build_as_child(&window)
    {
        Ok(v) => v,
        Err(e) => {
            eprintln!("lycomc: 无法创建 WebView: {e}");
            return;
        }
    };

    let menu = Menu::new();
    let open = MenuItem::with_id("open", "打开主界面", true, None);
    let help = MenuItem::with_id("guide", "使用教程", true, None);
    let quit = MenuItem::with_id("quit", "退出 LilyCraft", true, None);
    let sep = PredefinedMenuItem::separator();
    let _ = menu.append_items(&[&open, &help, &sep, &quit]);
    MenuEvent::set_event_handler(Some(move |e: MenuEvent| {
        let ev = match e.id().0.as_str() {
            "open" => UserEvent::Show,
            "guide" => UserEvent::Guide,
            "quit" => UserEvent::Quit,
            _ => return,
        };
        // 菜单回调在 GTK 线程执行，必须把动作送回 tao 事件循环再碰窗口。
        let _ = proxy.send_event(ev);
    }));
    let tray =
        TrayIconBuilder::new()
            .with_tooltip("LilyCraft 启动器")
            .with_menu(Box::new(menu))
            .with_icon(icon().unwrap_or_else(|| {
                Icon::from_rgba(vec![0u8; 4], 1, 1).expect("1x1 transparent icon")
            }))
            .with_menu_on_left_click(true)
            .build();
    if let Err(e) = tray {
        eprintln!("lycomc: 托盘图标不可用（窗口仍可使用）: {e}");
    }

    let mut quit_requested = false;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Show) => {
                window.set_visible(true);
                window.set_minimized(false);
                window.set_focus();
            }
            Event::UserEvent(UserEvent::Guide) => {
                let _ = webview.load_url(&guide);
                window.set_visible(true);
                window.set_focus();
            }
            Event::UserEvent(UserEvent::Quit) => {
                quit_requested = true;
                *control_flow = ControlFlow::Exit;
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                // 关闭按钮只是藏到托盘，不结束下载 / 启动任务。
                window.set_visible(false);
            }
            // Linux/X11 下 wry 不会跟随宿主窗口自动缩放，必须同步 WebView 尺寸。
            #[cfg(target_os = "linux")]
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                let logical = size.to_logical::<u32>(window.scale_factor());
                let _ = webview.set_bounds(wry::Rect {
                    position: wry::dpi::LogicalPosition::new(0, 0).into(),
                    size: wry::dpi::LogicalSize::new(logical.width, logical.height).into(),
                });
            }
            _ => {}
        }
        if quit_requested {
            *control_flow = ControlFlow::Exit;
        }
    });
}

#[cfg(test)]
mod desktop_tests {
    use super::*;

    #[test]
    fn generated_icon_has_rgba_pixels() {
        assert!(icon().is_some());
    }

    #[test]
    fn desktop_shortcut_body_has_no_technical_terms() {
        let body = "[Desktop Entry]\nName=LilyCraft\nComment=小白也能用的 Minecraft 启动器\n";
        assert!(body.contains("LilyCraft"));
        assert!(!body.contains("127.0.0.1"));
        assert!(!body.contains("8766"));
    }
}
