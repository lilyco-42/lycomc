// 最小 wry 诊断：argv[1]=URL，argv[2]=as_child/plain
fn main() {
    let url = std::env::args().nth(1).unwrap_or_else(|| {
        "data:text/html,<body style='background:%23ff0000'><h1>WRYMIN</h1></body>".to_string()
    });
    let as_child = std::env::args()
        .nth(2)
        .map(|m| m == "as_child")
        .unwrap_or(false);
    eprintln!("lycomc: loading {url} as_child={as_child}");
    let event_loop = tao::event_loop::EventLoopBuilder::<()>::with_user_event().build();
    let window = tao::window::WindowBuilder::new()
        .with_title(if as_child { "wrymin-child" } else { "wrymin" })
        .with_inner_size(tao::dpi::LogicalSize::new(900.0, 600.0))
        .build(&event_loop)
        .expect("window");
    let bounds = wry::Rect {
        position: wry::dpi::LogicalPosition::new(0, 0).into(),
        size: wry::dpi::LogicalSize::new(900u32, 600u32).into(),
    };
    let b = wry::WebViewBuilder::new()
        .with_url(&url)
        .with_bounds(bounds)
        .with_visible(true);
    let webview = if as_child {
        b.build_as_child(&window)
    } else {
        b.build(&window)
    };
    // 句柄必须活到事件循环结束，否则窗口会被立即回收
    let _webview = webview.expect("webview");
    eprintln!("lycomc: webview built");
    let mut ticks: u32 = 0;
    event_loop.run(move |_e, _t, cf| {
        *cf = tao::event_loop::ControlFlow::WaitUntil(
            std::time::Instant::now() + std::time::Duration::from_millis(500),
        );
        ticks += 1;
        if ticks == 30 {
            *cf = tao::event_loop::ControlFlow::Exit;
        }
    });
}
