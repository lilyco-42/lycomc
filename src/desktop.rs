//! 自研薄桌面壳：原生窗口 + 托盘 + 快捷方式，内核仍是同一份 axum。
//! Web 优先（m06445）：本模块只在 Cargo feature "desktop" 下编译，默认构建不链接系统 WebView。
//! Linux 在 Wayland 会话下强制 X11 后端，因为 wry/webkit2gtk 当前只支持 Xlib 句柄。
//! 品牌图标是离散实色的「等距方块 + 播放箭头」，不使用纯色渐变。

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
    FocusWebview,
}

const MARK: &str = "# 由 LilyCraft 启动器自动生成，可安全删除\n";
const MARK_SVG: &str = "<!-- 由 LilyCraft 启动器自动生成，可安全删除 -->\n";

/// 自研几何标识：等距方块 + 播放箭头。三个离散实色面，不使用线性渐变。
/// 前端 favicon / BrandMark、Linux 快捷方式、安装包图标共用同一组路径与色值。
const ICON_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="16" fill="#2078da"/>
  <path d="M32 12 L52 23 L32 34 L12 23 Z" fill="#9ec1ee"/>
  <path d="M12 23 L32 34 L32 52 L12 41 Z" fill="#5291df"/>
  <path d="M52 23 L32 34 L32 52 L52 41 Z" fill="#1662b6"/>
  <path d="M12 23 L32 12 L52 23 L32 34 Z M32 34 L32 52 M12 23 L12 41 L32 52 L52 41 L52 23" fill="none" stroke="#0b4a92" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M28 25 L40 31 L28 37 Z" fill="#ffffff"/>
</svg>"##;

/// 桌面 WebView 专用 IPC 消息：页面发现可编辑控件被重新聚焦时请求宿主抢回 GTK 键盘焦点。
const FOCUS_IPC: &str = "lycomc:focus-webview";

/// 注入到文档开头的监听器。wry 的 Linux 后端把 WebView 放进 GtkFixed 子容器，
/// 离开输入框再点回来时，X 窗口的焦点不一定回到 WebKit 内部；宿主收到消息后
/// 显式 focus_parent + focus，所有输入框（不只新手引导）都能继续打字。
/// 浏览器 --web 模式没有 window.ipc，这里会静默降级，不影响普通网页。
const FOCUS_SCRIPT: &str = r#"(function () {
  var last = 0;
  var send = function () {
    var now = Date.now();
    if (now - last < 120) return;
    last = now;
    if (window.ipc && typeof window.ipc.postMessage === "function") {
      window.ipc.postMessage("lycomc:focus-webview");
    }
  };
  var editable = function (node) {
    if (!node || node.nodeType !== 1) return false;
    var tag = node.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable;
  };
  document.addEventListener("focusin", function (event) {
    if (editable(event.target)) send();
  }, true);
  document.addEventListener("pointerdown", function (event) {
    if (editable(event.target)) send();
  }, true);
  send();
})();"#;

const ICON_W: u32 = 32;
const C_BG: [u8; 4] = [0x20, 0x78, 0xda, 255];
const C_TOP: [u8; 4] = [0x9e, 0xc1, 0xee, 255];
const C_LEFT: [u8; 4] = [0x52, 0x91, 0xdf, 255];
const C_RIGHT: [u8; 4] = [0x16, 0x62, 0xb6, 255];
const C_OUTLINE: [u8; 4] = [0x0b, 0x4a, 0x92, 255];
const C_WHITE: [u8; 4] = [255, 255, 255, 255];
const STROKE_W: f32 = 1.0;

fn put(rgba: &mut [u8], x: u32, y: u32, color: [u8; 4]) {
    let i = ((y * ICON_W + x) * 4) as usize;
    rgba[i..i + 4].copy_from_slice(&color);
}

/// 32x32 圆角画布：把 64x64 SVG 的 rect(1,1,30,30,r8) 光栅化。
fn rounded_bg(x: f32, y: f32) -> bool {
    if x < 1.0 || y < 1.0 || x >= 31.0 || y >= 31.0 {
        return false;
    }
    let (cx, cy) = if x < 9.0 && y < 9.0 {
        (9.0, 9.0)
    } else if x >= 23.0 && y < 9.0 {
        (23.0, 9.0)
    } else if x < 9.0 && y >= 23.0 {
        (9.0, 23.0)
    } else if x >= 23.0 && y >= 23.0 {
        (23.0, 23.0)
    } else {
        return true;
    };
    (x - cx).powi(2) + (y - cy).powi(2) <= 64.0
}

fn in_poly(pts: &[(f32, f32)], x: f32, y: f32) -> bool {
    let mut inside = false;
    let mut j = pts.len() - 1;
    for i in 0..pts.len() {
        let (xi, yi) = pts[i];
        let (xj, yj) = pts[j];
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn stroke(rgba: &mut [u8], a: (f32, f32), b: (f32, f32), color: [u8; 4]) {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let len2 = dx * dx + dy * dy;
    let half2 = (STROKE_W / 2.0).powi(2);
    for y in 0..ICON_W {
        for x in 0..ICON_W {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            if !rounded_bg(px, py) {
                continue;
            }
            let t = if len2 <= f32::EPSILON {
                0.0
            } else {
                ((px - a.0) * dx + (py - a.1) * dy) / len2
            };
            let t = t.clamp(0.0, 1.0);
            let qx = a.0 + t * dx;
            let qy = a.1 + t * dy;
            if (px - qx).powi(2) + (py - qy).powi(2) <= half2 {
                put(rgba, x, y, color);
            }
        }
    }
}

/// 托盘图标：与 ICON_SVG 同构的 32x32 RGBA，全部是离散纯色，没有插值渐变。
fn icon_rgba() -> Vec<u8> {
    let mut rgba = vec![0u8; (ICON_W * ICON_W * 4) as usize];
    let top = [(16.0, 6.0), (26.0, 11.5), (16.0, 17.0), (6.0, 11.5)];
    let left = [(6.0, 11.5), (16.0, 17.0), (16.0, 26.0), (6.0, 20.5)];
    let right = [(26.0, 11.5), (16.0, 17.0), (16.0, 26.0), (26.0, 20.5)];
    let play = [(14.0, 12.5), (20.0, 15.5), (14.0, 18.5)];
    for y in 0..ICON_W {
        for x in 0..ICON_W {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            if !rounded_bg(px, py) {
                continue;
            }
            put(&mut rgba, x, y, C_BG);
            if in_poly(&top, px, py) {
                put(&mut rgba, x, y, C_TOP);
            }
            if in_poly(&left, px, py) {
                put(&mut rgba, x, y, C_LEFT);
            }
            if in_poly(&right, px, py) {
                put(&mut rgba, x, y, C_RIGHT);
            }
        }
    }
    let edges = [
        ((16.0, 6.0), (26.0, 11.5)),
        ((26.0, 11.5), (16.0, 17.0)),
        ((16.0, 17.0), (6.0, 11.5)),
        ((6.0, 11.5), (16.0, 6.0)),
        ((16.0, 17.0), (16.0, 26.0)),
        ((6.0, 11.5), (6.0, 20.5)),
        ((6.0, 20.5), (16.0, 26.0)),
        ((26.0, 11.5), (26.0, 20.5)),
        ((26.0, 20.5), (16.0, 26.0)),
    ];
    for (a, b) in edges {
        stroke(&mut rgba, a, b, C_OUTLINE);
    }
    for y in 0..ICON_W {
        for x in 0..ICON_W {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            if rounded_bg(px, py) && in_poly(&play, px, py) {
                put(&mut rgba, x, y, C_WHITE);
            }
        }
    }
    rgba
}

fn icon() -> Option<Icon> {
    Icon::from_rgba(icon_rgba(), ICON_W, ICON_W).ok()
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

fn write_generated(path: &std::path::Path, marker: &str, content: &str) {
    let old = std::fs::read_to_string(path).unwrap_or_default();
    if !path.exists() || old.contains("LilyCraft") || old.contains(marker.trim()) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, format!("{marker}{content}"));
    }
}

fn write_if_ours(path: &std::path::Path, content: &str) {
    write_generated(path, MARK, content);
}

/// SVG 必须用 XML 注释开头；shell 风格的 # 会让它变成非法 XML。
fn write_svg_if_ours(path: &std::path::Path, content: &str) {
    write_generated(path, MARK_SVG, content);
}

#[cfg(target_os = "linux")]
fn shortcut_body(exe: &std::path::Path, icon: &std::path::Path) -> String {
    // Web 优先：没有 --desktop 时裸跑是浏览器控制台；快捷方式必须显式点名可选桌面壳。
    format!(
        "[Desktop Entry]\nType=Application\nName=LilyCraft\nComment=小白也能用的 Minecraft 启动器\nExec=\"{}\" --desktop\nIcon=\"{}\"\nTerminal=false\nCategories=Game;\nStartupWMClass=LilyCraft\n",
        exe.display(),
        icon.display()
    )
}

#[cfg(target_os = "linux")]
fn install_linux_shortcuts(exe: &std::path::Path) -> std::path::PathBuf {
    let home = crate::mc::paths::home_dir();
    let icon = home.join(".local/share/icons/hicolor/scalable/apps/lilycraft.svg");
    let svg = ICON_SVG;
    write_svg_if_ours(&icon, svg);
    let app = home.join(".local/share/applications/lilycraft.desktop");
    let body = shortcut_body(exe, &icon);
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
    let focus_proxy = proxy.clone();
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
        .with_ipc_handler(move |request| {
            // WebKit 回调不在 tao 主线程；只投递事件，窗体操作留在事件循环里。
            if request.body().contains(FOCUS_IPC) && request.uri().host() == Some("127.0.0.1") {
                let _ = focus_proxy.send_event(UserEvent::FocusWebview);
            }
        })
        .with_initialization_script(FOCUS_SCRIPT)
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0, 0).into(),
            size: wry::dpi::LogicalSize::new(logical.width, logical.height).into(),
        })
        .build_as_child(&window)
    {
        Ok(v) => {
            // 首屏就抢焦点：child 模式嵌进 GtkFixed 后，宿主窗口拿到 X 焦点
            // 并不等于 WebView 内部的输入控件拿到 GTK 焦点。
            let _ = v.focus();
            v
        }
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
    let menu_proxy = proxy.clone();
    MenuEvent::set_event_handler(Some(move |e: MenuEvent| {
        let ev = match e.id().0.as_str() {
            "open" => UserEvent::Show,
            "guide" => UserEvent::Guide,
            "quit" => UserEvent::Quit,
            _ => return,
        };
        // 菜单回调在 GTK 线程执行，必须把动作送回 tao 事件循环再碰窗口。
        let _ = menu_proxy.send_event(ev);
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
            Event::UserEvent(UserEvent::FocusWebview) => {
                // 输入框离开再回来时，由页面的 focusin/pointerdown 主动请求重聚焦。
                let _ = webview.focus_parent();
                let _ = webview.focus();
            }
            Event::UserEvent(UserEvent::Show) => {
                window.set_visible(true);
                window.set_minimized(false);
                let _ = proxy.send_event(UserEvent::FocusWebview);
            }
            Event::UserEvent(UserEvent::Guide) => {
                let _ = webview.load_url(&guide);
                window.set_visible(true);
                let _ = proxy.send_event(UserEvent::FocusWebview);
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
            Event::WindowEvent {
                event: WindowEvent::Focused(true),
                ..
            } => {
                let _ = proxy.send_event(UserEvent::FocusWebview);
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
    use std::collections::HashSet;

    #[test]
    fn generated_icon_has_rgba_pixels() {
        assert_eq!(icon_rgba().len(), (ICON_W * ICON_W * 4) as usize);
        assert!(icon().is_some());
    }

    #[test]
    fn generated_icon_has_discrete_faces() {
        let mut colors = HashSet::new();
        let rgba = icon_rgba();
        for i in (0..rgba.len()).step_by(4) {
            let px = &rgba[i..i + 4];
            if px[3] == 255 {
                colors.insert([px[0], px[1], px[2]]);
            }
        }
        assert!(
            colors.len() >= 5,
            "expected discrete face colors, got {}",
            colors.len()
        );
        for c in [C_BG, C_TOP, C_LEFT, C_RIGHT, C_WHITE, C_OUTLINE] {
            assert!(colors.contains(&[c[0], c[1], c[2]]));
        }
    }

    #[test]
    fn focus_bridge_requests_only_for_editable_controls() {
        assert!(FOCUS_SCRIPT.contains(FOCUS_IPC));
        assert!(FOCUS_SCRIPT.contains("focusin"));
        assert!(FOCUS_SCRIPT.contains("pointerdown"));
        assert!(FOCUS_SCRIPT.contains("editable(event.target)"));
        assert!(FOCUS_SCRIPT.contains("window.ipc"));
        assert!(FOCUS_SCRIPT.contains("Date.now()"));
    }

    #[test]
    fn brand_svg_has_no_gradient() {
        assert!(!ICON_SVG.contains("Gradient"));
        assert!(!ICON_SVG.contains("url(#"));
        assert!(ICON_SVG.contains("M32 12 L52 23 L32 34 L12 23 Z"));
        assert!(ICON_SVG.contains("M28 25 L40 31 L28 37 Z"));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn desktop_shortcut_body_has_no_technical_terms() {
        let exe = std::path::Path::new("/opt/lycomc/lycomc");
        let icon = std::path::Path::new("/home/u/.local/share/icons/lilycraft.svg");
        let body = shortcut_body(exe, icon);
        assert!(body.contains("LilyCraft"));
        assert!(body.contains("Exec=\"/opt/lycomc/lycomc\" --desktop"));
        assert!(body.contains("Icon=\"/home/u/.local/share/icons/lilycraft.svg\""));
        assert!(!body.contains("127.0.0.1"));
        assert!(!body.contains("8766"));
    }
}
