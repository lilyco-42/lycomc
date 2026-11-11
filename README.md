# lycomc —— 类 PCL 的 Minecraft 启动器

**lilyco 命令面（CLI / TUI / MCP / Web 四端）+ shadcn UI 桌面控制台**，内核用 Rust 从零实现。

一个二进制、四种用法，共用同一份内核与同一份配置（`~/.local/share/lycomc`）：

| 入口 | 形态 | 用途 |
|---|---|---|
| `lycomc` / `lycomc --web` | 本地 Web 控制台（PCL 风界面） | 产品主入口，浏览器里点按钮装版本、启动、管 Mod |
| `lycomc <子命令>` | CLI | 脚本 / 终端用户，14 个子命令 |
| `lycomc --tui` | 终端全屏界面 | 无浏览器的机器上选命令、填参数、看结果（需真 TTY） |
| `lycomc --mcp` | MCP 服务器 | 交给 AI Agent 调用（写操作走白名单策略） |

## 实测跑通的链路（真实网络 / 真实 JVM / 真实渲染）

- **原版安装**：`lycomc install --version 1.20.1` → 3600 个文件 / 623.9 MB，含 assets 索引与 objects、88 个 libraries、natives 解压。
- **离线启动**：`lycomc launch --version-id 1.20.1 --account Steve` → 日志出现 `Setting user: Steve` / `LWJGL 3.3.1` / `Sound engine started` / 全套 atlas `Created`，即真进主菜单。
- **Fabric**：装 `fabric-loader-0.20.1-1.20.1`，启动日志 `Loading 59 mods:` + Sodium 生效。
- **Modrinth**：装 Sodium / Fabric API 到实例 `mods/`，列表可读、可删。
- **Web 全链路**：首页点「启动游戏」→ SSE 进度 + 日志尾 → 「游戏运行中 PID」→「结束进程」。
- **中文本地化**：`gameLang` 默认 `zh_cn`（启动前写入实例 `options.txt`）；「版本管理 → 一键汉化」异步装 CFPA 模组汉化包与 Sodium 中文包，游戏主菜单与 Mod 设置页均中文。汉化包仅运行时下载、不内嵌二进制。
- **国内镜像**：下载源支持 Mojang / BMCLAPI；Modrinth API 与 CDN 自动回落 MCIM 中国镜像，CFPA 资源包经 gh-proxy.com 加速。

> 唯一已知无害报错：`UnsatisfiedLinkError: libflite.so`（Narrator 语音库，系统未装，不影响游戏）。

## 快速开始

```bash
# 构建（前端产物会被 include_dir! 编进二进制，所以先建前端）
cd web && pnpm install && pnpm build
cd .. && cargo build --release
# 产物：~/.cache/lilyco-build/target/release/lycomc（cargo config 把 target-dir 指到了 ~/.cache）

lycomc                      # 起 Web 控制台（默认 http://127.0.0.1:8766）
lycomc install --version 1.20.1
lycomc launch  --version-id 1.20.1 --account Steve
lycomc list                 # 已装实例
lycomc javas                # 系统 Java 探测
lycomc mod-search --query sodium --version-id 1.20.1
lycomc --schema             # 全部命令的 JSON 清单（给脚本 / Agent 看）
# Web 控制台：版本管理页点「一键汉化」，设置页选「游戏语言」
```

环境变量：`LYCOMC_PORT`（Web 端口，默认 8766）、`LYCOMC_NO_OPEN=1`（不自动开浏览器）、`LYCOMC_DATA_DIR`（数据根）。

## 界面

| 主页 | 运行中 |
|---|---|
| ![主页](docs/screenshots/home.png) | ![运行中](docs/screenshots/running.png) |
| **版本管理** | **下载** |
| ![版本管理](docs/screenshots/versions.png) | ![下载](docs/screenshots/download.png) |
| **Mod 管理** | **设置** |
| ![Mod 管理](docs/screenshots/mods.png) | ![设置](docs/screenshots/settings.png) |

真实启动进主菜单（原版 1.20.1）：

![主菜单](docs/screenshots/game-main-menu.png)

中文本地化实测（Fabric 1.20.1 + Sodium，游戏内截图）：

| 中文主菜单 | 中文选项页 | 中文 Mod 设置页（Sodium） |
|---|---|---|
| ![中文主菜单](docs/screenshots/game-zh-menu.png) | ![中文选项页](docs/screenshots/game-zh-options.png) | ![Sodium 中文](docs/screenshots/game-zh-sodium.png) |

## 五个页面

- **主页**：巨型渐变启动按钮（PCL 风）、实例卡、分配内存、运行中 PID + 结束进程、SSE 实时进度与日志尾、远程最新版、Java 状态。
- **版本管理**：已装实例列表、切换当前实例、删除、看详情（Mod 数 / 运行中）、一键汉化（已汉化显示徽章）。
- **下载**：远程 900+ 版本（正式版 / 快照 / 全部）、搜索、分页、一键安装（可同时装 Fabric）。
- **Mod 管理**：Modrinth 搜索（400ms 去抖）+ 一键装（自动拉依赖）+ 已装列表删除。
- **设置**：内存滑块、Java 运行时选择、额外 JVM 参数、下载源（Mojang / BMCLAPI）、并发数、关闭行为、游戏语言（默认简体中文）、离线账号。

## 架构

```
src/
  main.rs      四端分发：裸跑/--web → Web 控制台；子命令 → CLI；--tui / --mcp → lilyco
  commands.rs  lilyco 命令注册表（14 个命令，CLI/TUI/MCP/Web 共用同一份）
  policy.rs    安全策略：本地面放行 T0/T1；MCP 面写操作仅白名单
  api.rs       axum REST + SSE + 内嵌前端静态资源（fallback）
  jobs.rs      任务表 + broadcast 事件流
  settings.rs  配置与离线账号持久化
  mc/          MC 内核（与前端完全解耦）
    meta.rs      版本 JSON 解析、规则求值、参数拼装
    install.rs   库/资源下载计划、natives 解压、版本合并
    download.rs  并发下载 + 进度泵 + 哈希校验
    fabric.rs    Fabric loader 元数据与合并
    launch.rs    参数拼装、natives 补齐、子进程与日志
    java.rs      Java 探测与 Adoptium 下载
    modrinth.rs  Modrinth 搜索 / 安装 / 删除（MCIM 镜像回落）
    options.rs   options.txt 原子改写（lang / resourcePacks）
    localize.rs  一键汉化：CFPA + Sodium 资源包下载、pack_format 兼容重写
web/          React 19 + shadcn/ui + Tailwind 4 + hash 路由，构建产物被 include_dir! 编进二进制
```

**关键设计**：Rust 只依赖 `lilyco` facade，不直接依赖 `lilyco-*`；前端不打包成独立站点，而是编进二进制（单文件分发，`/api/*` 与静态资源同一个 axum 服务）。

## 文档

- [docs/DECISION.md](docs/DECISION.md) —— lyco 预研：候选对比、niche 知识、为什么自研薄壳
- [docs/CONTRACT.md](docs/CONTRACT.md) —— 前后端契约（HTTP API、类型、数据根布局、变更记录）
- [docs/DECISION.md](docs/DECISION.md) 末节 —— 本地化 / 镜像源调研与许可说明（CFPA 包 CC BY-NC-SA 4.0、Sodium 中文包 MIT）；本项目二进制不含第三方汉化资源，用户点「一键汉化」时自行下载。

## License

个人项目，未指定。
