//! lycomc —— Minecraft 启动器（lilyco 命令面 + shadcn Web 控制台）。
//!
//! CLI / TUI / MCP / Web / 桌面壳共用一份内核与一份配置（Web 优先）：
//!   lycomc              裸跑 → 启动本地 Web 控制台（主入口，自动开浏览器）
//!   lycomc --web        浏览器控制台（兼容旧用法，等价于裸跑）
//!   lycomc --desktop    可选 feature（构建时 --features desktop）：LilyCraft 原生桌面窗口
//!   lycomc <子命令>     CLI 形态，脚本 / AI 友好
//!   lycomc --tui        TUI 形态
//!   lycomc --mcp        MCP 服务器形态，交给 Agent 调用
//!
//! 内核（下载 / 安装 / 启动）全在 src/mc 里，与前端无关。

#[cfg(all(
    feature = "desktop",
    any(target_os = "linux", target_os = "windows", target_os = "macos")
))]
use lycomc::desktop;
use lycomc::{api, commands, mc, policy};

use std::sync::Arc;

use lilyco::prelude::SafetyPolicy;

const BANNER: &str = "lycomc —— Minecraft 启动器（lilyco + shadcn）";

// 桌面壳只在显式 feature 下参与编译；未启用时 --desktop 仍可用，只是清楚提示后回落 Web。
// 这样裸跑、--web、CLI、TUI、MCP 全都不受桌面依赖影响。
#[cfg(all(
    feature = "desktop",
    any(target_os = "linux", target_os = "windows", target_os = "macos")
))]
fn handle_desktop_request() {
    if desktop::available() {
        desktop::run(); // 仅在窗口或托盘不可用时返回
    }
    println!("{BANNER}");
    println!("（桌面窗口不可用，已切换到浏览器界面）");
}

#[cfg(not(all(
    feature = "desktop",
    any(target_os = "linux", target_os = "windows", target_os = "macos")
)))]
fn handle_desktop_request() {
    println!("{BANNER}");
    println!(
        "（当前构建未启用桌面壳，已切换到浏览器界面；如需桌面壳请用 --features desktop 构建）"
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // 注意：install 等子命令自带 --version <版本> 参数，所以只有「单独一个 --version」
    // 或第一个参数就是 --version 时才当作全局版本查询。
    let wants_version = args
        .first()
        .map(|a| a == "--version" || a == "-V")
        .unwrap_or(false)
        || (args.len() == 1 && args[0] == "--version");
    if wants_version {
        println!(
            "lycomc {} ({} {})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        );
        println!("数据目录: {}", mc::paths::data_dir().display());
        let ids = mc::install::installed_ids();
        println!("已安装实例: {} 个", ids.len());
        return;
    }

    if let Err(e) = mc::paths::ensure_all() {
        eprintln!("lycomc: 无法创建数据目录: {e}");
    }

    // Web 优先（m06445）：无参数裸跑就起本地 Web 控制台并自动开浏览器；
    // 原生桌面壳降级为显式 --desktop / LILYCO_UI=desktop 的可选 feature，不再抢占主入口。
    let wants_desktop = args.iter().any(|a| a == "--desktop")
        || std::env::var("LILYCO_UI")
            .map(|v| v == "desktop")
            .unwrap_or(false);
    if wants_desktop {
        handle_desktop_request();
        api::serve();
        return;
    }

    // --web / --gui / --no-desktop 与 LILYCO_UI=web|gui 保留兼容；
    // 无参数（双击 / 裸跑）现在同样直接进 Web 控制台。
    let wants_web = args
        .iter()
        .any(|a| a == "--web" || a == "--gui" || a == "--no-desktop")
        || std::env::var("LILYCO_UI")
            .map(|v| v == "web" || v == "gui")
            .unwrap_or(false);
    if args.is_empty() || wants_web {
        api::serve();
        return;
    }

    // --tui 需要真终端：没有 TTY 时 TUI 初始化必然失败并回落到 CLI，
    // 而 CLI 的 clap 不认识 --tui，会报 "unexpected argument '--tui' found"，
    // 用户只看到一句莫名其妙的 clap 错误。这里提前给出可执行的提示。
    if args.iter().any(|a| a == "--tui") && !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        eprintln!("lycomc: --tui 需要交互终端（当前 stdin 不是 TTY）。");
        eprintln!("无终端时请改用：lycomc --web（浏览器界面）或 lycomc <子命令>（脚本友好）");
        std::process::exit(2);
    }

    let backend = lilyco::detect_registry_backend();
    let policy: Arc<dyn SafetyPolicy> = match backend {
        lilyco::Backend::Mcp => Arc::new(policy::Agent),
        _ => Arc::new(policy::LocalOnly),
    };
    // 策略必须同时交给注册表构造（门在 register 时就包住 handler）与分发入口。
    let registry = commands::registry_with_policy(Arc::clone(&policy));
    lilyco::run_registry_with_policy("lycomc", registry, backend, policy);
}
