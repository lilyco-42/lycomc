# lycomc 预研决策（lyco 流程，2026-11-11）

## 需求（一行）
仿 PCL2 的 Minecraft 启动器：lilyco 命令面（CLI/TUI/MCP/Web 四端）+ shadcn React 桌面 UI，
MVP 必须真跑通「下载原版 1.20.1 → 离线登录 → 真启动进主菜单」，并能装 Fabric 与 Modrinth Mod。

## 候选（gh 检索，含源）
| 项目 | ★ | License | 语言 | 结论 |
|---|---|---|---|---|
| HMCL-dev/HMCL | 10952 | GPL-3.0 | Java | 功能最全，但 Java+GPL，不能当 Rust 骨架 |
| Voxelum/x-minecraft-launcher | 1708 | MIT | TS/Electron | 架构参考，非 PCL 风 |
| Moulberry/PandoraLauncher | 953 | MIT | Rust | Rust 启动器实现参考（自家 vendor） |
| UNIkeEN/SJMCL | 801 | GPL-3.0 | TS/Tauri | PCL 风 UI 参考 |
| Star-tears/mc-launcher-core | 15 | MIT | Rust | 库，不是应用 |

## niche 知识（文档没写、实测得来）
1. 离线启动必须同时传 --uuid（md5("OfflinePlayer:"+name) 的 v3 UUID）与 --accessToken（任意串），否则 1.20+ 崩。
2. natives 不是独立 jar：新版是 libraries 里的 classifier natives-linux/natives-windows，必须解压到独立目录再 -Djava.library.path=。
3. assetIndex 必须放 assets/indexes/<id>.json 且不能改写；objects 落 assets/objects/xx/<hash>。
4. Java 硬门槛：1.20.1=17，1.21.x=21，26.x=25；用错直接 UnsupportedClassVersionError。
5. Linux GLFW 需要 DISPLAY/Wayland，无显示环境会 GLFW error 65542。

## 决策
build-from-scratch（薄壳）：lilyco 给四端与命令面，shadcn 给 UI，MC 内核自己实现（Rust）。
理由：无现成 Rust+lilyco 可嵌入骨架；需求硬约束 =「lilyco 框架 + shadcn UI」。
代价：自实现 meta 解析/下载校验/参数拼装（约 2.5k 行）。

## 命名硬约束
- 二进制 lycomc；数据根 ~/.local/share/lycomc
- Rust 只依赖 lilyco facade，不直接依赖 lilyco-*

## 落地结果（同日完成）

- 代码：Rust 内核 ~4.1k 行（src/），前端 ~6.0k 行（web/src/），单二进制 5.9 MB（前端 include_dir! 内嵌）。
- 实测：原版 1.20.1 安装 3600 文件 / 623.9 MB → 离线启动进主菜单；Fabric loader 0.20.1 → Loading 59 mods + Sodium 生效；Modrinth 装/删 Mod 正常；Web 端启动 / 结束进程 / SSE 进度全通。
- 四端：CLI（14 子命令）、TUI（pty 实测选择页 → 参数页 → 确认 → 结果 JSON）、MCP（tools/list 返回 14 个工具）、Web（五页面截图见 docs/screenshots）。
- 教训沉淀：① lilyco App derive 只生成 `--flag <值>`，没有位置参数；② 所有 axum Query/Json 结构体必须显式 `rename_all = "camelCase"`，且 PUT 类接口要用全 Option 的 Patch 结构做部分更新，否则 serde default 会静默重置未传字段；③ Modrinth API 是 snake_case，不要加 camelCase；④ Fabric 实例必须沿本地父链合并 json、把 inheritsFrom 还回去、并单独解压 natives。
