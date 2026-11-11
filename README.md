# lycomc —— 类 PCL 的 Minecraft 启动器

**lilyco 命令面（CLI / TUI / MCP / Web 四端）+ shadcn UI 桌面控制台**，内核用 Rust 从零实现。

一个二进制、四种用法，共用同一份内核与同一份配置（`~/.local/share/lycomc`）：

| 入口 | 形态 | 用途 |
|---|---|---|
| `lycomc` / `lycomc --web` | 本地 Web 控制台（PCL 风界面） | 产品主入口，浏览器里点按钮装版本、启动、管 Mod |
| `lycomc <子命令>` | CLI | 脚本 / 终端用户，14 个子命令 |
| `lycomc --tui` | 终端全屏界面 | 无浏览器的机器上选命令、填参数、看结果 |
| `lycomc --mcp` | MCP 服务器 | 交给 AI Agent 调用（写操作走白名单策略） |

## 实测跑通的链路（真实网络 / 真实 JVM / 真实渲染）

- **原版安装**：`lycomc install --version 1.20.1` → 3600 个文件 / 623.9 MB，含 assets 索引与 objects、88 个 libraries、natives 解压。
- **离线启动**：`lycomc launch --version-id 1.20.1 --account Steve` → 日志出现 `Setting user: Steve` / `LWJGL 3.3.1` / `Sound engine started` / 全套 atlas `Created`，即真进主菜单。
- **Fabric**：装 `fabric-loader-0.20.1-1.20.1`，启动日志 `Loading 59 mods:` + Sodium 生效。
- **Modrinth**：装 Sodium / Fabric API 到实例 `mods/`，列表可读、可删。
- **Web 全链路**：首页点「启动游戏」→ SSE 进度 + 日志尾 → 「游戏运行中 PID」→「结束进程」。

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
```

环境变量：`LYCOMC_PORT`（Web 端口，默认 8766）、`LYCOMC_NO_OPEN=1`（不自动开浏览器）、`LYCOMC_DATA_DIR`（数据根）。

## 五个页面

- **主页**：巨型渐变启动按钮（PCL 风）、实例卡、分配内存、运行中 PID + 结束进程、SSE 实时进度与日志尾、远程最新版、Java 状态。
- **版本管理**：已装实例列表、切换当前实例、删除、看详情（Mod 数 / 运行中）。
- **下载**：远程 900+ 版本（正式版 / 快照 / 全部）、搜索、分页、一键安装（可同时装 Fabric）。
- **Mod 管理**：Modrinth 搜索（400ms 去抖）+ 一键装（自动拉依赖）+ 已装列表删除。
- **设置**：内存滑块、Java 运行时选择、额外 JVM 参数、下载源（Mojang / BMCLAPI）、并发数、关闭行为、离线账号。

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
    modrinth.rs  Modrinth 搜索 / 安装 / 删除
web/          React 19 + shadcn/ui + Tailwind 4 + hash 路由，构建产物被 include_dir! 编进二进制
```

**关键设计**：Rust 只依赖 `lilyco` facade，不直接依赖 `lilyco-*`；前端不打包成独立站点，而是编进二进制（单文件分发，`/api/*` 与静态资源同一个 axum 服务）。

## 文档

- [docs/DECISION.md](docs/DECISION.md) —— lyco 预研：候选对比、niche 知识、为什么自研薄壳
- [docs/CONTRACT.md](docs/CONTRACT.md) —— 前后端契约（HTTP API、类型、数据根布局、变更记录）

## License

个人项目，未指定。
