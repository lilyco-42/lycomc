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

## 本地化与镜像源补做（同日，用户后续需求）

用户反馈「游戏和 Mod 却是英文」「找到镜像源和翻译好的 mod」。根因：启动器从不写实例 `options.txt`，Fabric 实例默认 `lang:en_us`；Sodium jar 只有 `assets/sodium/lang/en_us.json`。

- 镜像源调研：BMCLAPI 清单 / 1.20.1 json / maven 均 200；MCBBS 旧镜像 TLS 已死；新增 MCIM 镜像作为 Modrinth API/CDN 的自动回落（`mod.mcimirror.top/modrinth/v2`、`mod.mcimirror.top/data/...`，CDN 路径必须保留 `/data/`）；CFPA GitHub release 经 gh-proxy.com 最快（0.87s）。
- 汉化包调研：CFPAOrg/Minecraft-Mod-Language-Package 的 1.20-Fabric 分包（785759 B / 252 个 zh_cn.json，包内 LICENSE 为 CC BY-NC-SA 4.0）；Sodium 中文包 Modrinth `c6ZgwIPR`（MIT，79 条 zh_cn 词条）。**合规决策：只运行时下载到实例 resourcepacks/，绝不内嵌二进制**。
- 落地：新增 `src/mc/options.rs`（原子改写 options.txt 的 lang / resourcePacks，其余行原样保留）与 `src/mc/localize.rs`（一键汉化任务），`launch::prepare` 启动前按 `gameLang` 写语言；`POST /api/localize`、`GET /api/versions/:id` 三字段、`Settings.gameLang`（默认 zh_cn）。
- 兼容性坑：Sodium 中文包 `pack.mcmeta` 是 `pack_format:61 / supported_formats 13..61`（面向 1.21+），而 1.20.1 client jar `version.json` 是 resource pack_format 15，游戏会 `Removed resource pack ... no longer compatible` 直接丢弃。修法：下载后读取本地 client jar 的 `pack_version.resource`，用 zip crate 重写包内 `pack.mcmeta`（保留作者追加的 `//` 注释需截到最后一个 `}` 再 parse，其余条目 raw_copy_file 原样搬运）。
- 实测：两包同时出现在 `Reloading ResourceManager`，无兼容警告；主菜单「单人游戏/多人游戏/选项...」中文；Sodium 视频设置页「通用/画质/性能/高级、渲染距离、垂直同步」中文。截图见 docs/screenshots/game-zh-{menu,options,sodium}.png。
- 教训沉淀：⑤ Modrinth CDN 对部分 UA 恒返回 HTTP 400 `OnDemandMigrationSourceStatus`，换 UA / 换 MCIM 镜像 / 换正确文件名即可，别一次失败就判定资源不存在；⑥ 资源包必须核对目标 MC 版本的 `pack_version.resource`，别信 `supported_formats` 上限。
