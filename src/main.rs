//! lycomc —— Minecraft 启动器（lilyco 命令面 + shadcn Web 控制台）。
//!
//! 四种前端共用一份内核与一份配置：
//!   lycomc              裸跑 → 起本地 Web 控制台（主入口，PCL 风界面）
//!   lycomc --web        同上（显式）
//!   lycomc <子命令>     CLI 形态，脚本 / AI 友好
//!   lycomc --tui        TUI 形态
//!   lycomc --mcp        MCP 服务器形态，交给 Agent 调用
//!
//! 内核（下载 / 安装 / 启动）全在 src/mc 里，与前端无关。

mod api;
mod assets;
mod commands;
mod jobs;
mod mc;
mod policy;
mod settings;

use std::sync::Arc;

use lilyco::prelude::SafetyPolicy;

const BANNER: &str = "lycomc —— Minecraft 启动器（lilyco + shadcn）";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // 注意：install 等子命令自带 --version <版本> 参数，所以只有「单独一个 --version」
    // 或第一个参数就是 --version 时才当作全局版本查询。
    let wants_version = args.first().map(|a| a == "--version" || a == "-V").unwrap_or(false)
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

    // --web / --gui 走本项目自己的 axum 控制台（不是 lilyco-gui 的通用表单页）
    let wants_web = args.iter().any(|a| a == "--web" || a == "--gui")
        || std::env::var("LILYCO_UI")
            .map(|v| v == "web" || v == "gui")
            .unwrap_or(false);
    if wants_web {
        api::serve();
        return;
    }

    // 裸跑 → 直接起 Web 控制台，这是产品主入口
    if args.is_empty() {
        println!("{BANNER}");
        println!("（裸跑默认启动 Web 控制台；CLI 用法：lycomc --help）");
        api::serve();
        return;
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