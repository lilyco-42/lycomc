# lycomc —— 类 PCL 的 Minecraft 启动器

**lilyco 命令面（CLI / TUI / MCP / Web 四端）+ shadcn UI 桌面控制台**，内核用 Rust 从零实现。

一个二进制、四种用法，共用同一份内核与同一份配置（`~/.local/share/lycomc`）：

| 入口 | 形态 | 用途 |
|---|---|---|
| `lycomc`（双击 / 裸跑） | 原生桌面窗口（LilyCraft 启动器） | **小白主入口**：装好就能双击用，窗内就是同一套界面，关窗最小化到托盘 |
| `lycomc --web` | 本地 Web 控制台（PCL 风界面） | 浏览器里点按钮装版本、启动、管 Mod |
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
- **国内镜像**：默认下载源 bmcl（设置页可切回 Mojang 官方），BMCLAPI 覆盖版本清单/JSON/libraries/assets/Fabric meta 与 maven 库；Modrinth 搜索与文件优先 MCIM 中国镜像；托管 JRE 优先清华 TUNA；CFPA 汉化包经 gh-proxy.com / ghfast.top / hk.gh-proxy.com 多级回落。所有请求统一 UA lycomc/0.1，主源失败自动回落官方，实测各端点均 200。

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

## 六个页面

- **主页**：巨型渐变启动按钮（PCL 风）、实例卡、分配内存、运行中 PID + 结束进程、SSE 实时进度与日志尾、远程最新版、Java 状态。
- **版本管理**：已装实例列表、切换当前实例、删除、看详情（Mod 数 / 运行中）、一键汉化（已汉化显示徽章）。
- **下载**：远程 900+ 版本（正式版 / 快照 / 全部）、搜索、分页、一键安装（可同时装 Fabric）。
- **Mod 管理**：Modrinth 搜索（400ms 去抖）+ 一键装（自动拉依赖）+ 已装列表删除。
- **设置**：内存滑块、Java 运行时选择、额外 JVM 参数、下载源（Mojang 官方 / BMCLAPI 国内镜像，默认 BMCLAPI）、并发数、关闭行为、游戏语言（默认简体中文）、离线账号。
- **使用教程 `#/guide`**：四步图文 + 三条 FAQ，全中文、无术语，随时可从顶栏或侧栏回到这里。

## 桌面客户端（开箱即用）

```bash
lycomc            # 双击图标或裸跑：直接开原生窗口，不起浏览器
```

- **零术语首启向导**：第一次打开是三步引导（认识它 / 取个名字 / 选个版本），任何一步都能「跳过引导」，不认字也能点完。
- **使用教程 `#/guide`**：四步图文（装版本 / 正版账号 / 装 Mod / 变中文）+ 三条常见问题（打不开、没 Java、下载慢），顶栏问号与侧栏「使用教程」都能进；教程页里可「重看新手引导」。
- **窗口**：1180x780 起，拖动缩放界面跟随；关窗只最小化到托盘，托盘菜单有「打开主界面 / 使用教程 / 退出 LilyCraft」。
- **快捷方式**：Linux 首次运行自动生成应用菜单项、图标和桌面图标（`~/.local/share/applications/lilycraft.desktop`、`~/Desktop/LilyCraft.desktop`）。
- **零端口零 IP**：内嵌服务只绑 `127.0.0.1` 的随机端口，端口号与地址不出现在界面和日志里。

## 多平台

| 平台 | 形态 | 状态 |
|---|---|---|
| Linux | 桌面窗口 / deb / AppImage | ✅ 实机验过（窗口、缩放、托盘、关窗最小化、快捷方式） |
| Windows | 桌面窗口 / NSIS 安装器 | 🟡 同一份 `src/desktop.rs` 源码 + 构建工作流，未产出已签名 .exe |
| macOS | 桌面窗口 / .app + DMG | 🟡 同上，无 mac 实机 |
| Android | Kotlin WebView 壳 + JNI 启动本地内核 | 🟡 `android/` 源码 + 工作流，仓库不含 APK |
| 浏览器 | PWA（`manifest.webmanifest`，可添加到主屏幕） | ✅ 实测 manifest 正常返回 |

> 说明：Android 当前定位是**本地管理 / 教程 / 远程控制壳**，不在手机上直接跑 Java 版 MC。已签名安装包与 Windows/macOS/Android 实机验收都还没做，不在本文宣称已达成。

打包与构建：

```bash
bash scripts/package-front.sh        # 先建前端产物
cargo packager --release -c packaging/Packager.toml   # 需 cargo install cargo-packager
bash scripts/build-android.sh        # 需 Android SDK + NDK + cargo-ndk + Gradle
```

CI 见 `.github/workflows/release.yml`（手动触发，只上传 artifact，不建 Release、不打 tag）。

## 架构

```
src/
  main.rs      入口分发：桌面窗口（默认）/ --web → Web 控制台；子命令 → CLI；--tui / --mcp → lilyco
  lib.rs       rlib + cdylib 门面，含 start_embedded() 与 Android JNI 入口
  desktop.rs   原生窗口（wry）+ 托盘 + 自绘图标 + Linux 快捷方式
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
    java.rs      Java 探测与托管 JRE 下载（Adoptium / 清华 TUNA 优先）
    modrinth.rs  Modrinth 搜索 / 安装 / 删除（MCIM 镜像回落）
    options.rs   options.txt 原子改写（lang / resourcePacks）
    localize.rs  一键汉化：CFPA + Sodium 资源包下载、pack_format 兼容重写
web/          React 19 + shadcn/ui + Tailwind 4 + hash 路由，构建产物被 include_dir! 编进二进制
```

**关键设计**：Rust 只依赖 `lilyco` facade，不直接依赖 `lilyco-*`；前端不打包成独立站点，而是编进二进制（单文件分发，`/api/*` 与静态资源同一个 axum 服务）。

## 文档

- [docs/DECISION.md](docs/DECISION.md) —— lyco 预研：候选对比、niche 知识、为什么自研薄壳
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md) —— 逐轮测试记录与平台达成矩阵（§7 为桌面壳/教程/四端源码）
- [docs/CONTRACT.md](docs/CONTRACT.md) —— 前后端契约（HTTP API、类型、数据根布局、变更记录）
- [docs/DECISION.md](docs/DECISION.md) 末节 —— 本地化 / 镜像源调研、接入决策与许可说明（CFPA 包 CC BY-NC-SA 4.0、Sodium 中文包 MIT）；本项目二进制不含第三方汉化资源，用户点「一键汉化」时自行下载。国内镜像决策：adopt 现状 + 局部补齐，CurseForge 完整接入 / Forge·NeoForge·OptiFine 安装器 / 自搭反代 ROI 未过门槛暂不做。

## 开发与维护边界

本仓库当前把 `lilyco` 依赖写成绝对路径（`/home/lilyco/code/lilyco/lilyco`），因此定位为**本机开发仓库**，不提供公共 CI：

```bash
# 需要 pnpm 9+；前端产物会被 include_dir! 编进二进制
./scripts/check.sh
```

本地检查包含 `pnpm lint`、前端构建、`cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`。`.github/workflows/release.yml` 是为多平台出包准备的**手动**工作流，同样受这条限制：要让它在公共 runner 上真正跑通，需要先把 `Cargo.toml` 的 `lilyco` 依赖改成可复现的 git rev 或发布包，并在 CI 中检出对应源码（当前 Rust 检查步骤带 `|| true` 就是为了不误报）。

## License

个人项目，未指定。
