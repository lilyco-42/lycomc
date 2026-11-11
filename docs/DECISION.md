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


## 国内镜像源接入（决策：adopt 现状 + 局部补齐，2026-11-11）

**需求**：m01687「找一下 国内镜像源」→ m01722「继续搞好吧」（授权落地，不再追问）。
按五信条先做 WebSearch + gh 近义词检索 + 论坛/官方文档引用 + 真机 HTTP 探测，
再评估主流方案；所有候选均来自真实 gh / 官方页面，不臆造仓库。

**候选与实测（2026-11-11，均为真实 HTTP 结果）**
- BMCLAPI \`bmclapi2.bangbang93.com\`：清单、version json、maven、assets、fabric-meta
  （255 项 loader，与官方一致）、forge / neoforge / optifine 元数据全部 200；
  会 302 到 OpenBMCLAPI 节点（hurtmc / lunar / USTC），**不能写死跳转后 URL**。
  源：[bangbang93/openbmclapi](https://github.com/bangbang93/openbmclapi) MIT 407★。
- MCIM \`mod.mcimirror.top\`：Modrinth API/CDN、CurseForge search 200，结构同官方；
  CDN 路径必须保留 \`/data/\`。源：[mcmod-info-mirror/mcim-rust-api](https://github.com/mcmod-info-mirror/mcim-rust-api) MIT 33★
  （旧 mcim-api 已归档）。[替换总表](https://www.mcimirror.top/guide/start/getting-started)、
  [接入登记](https://www.mcimirror.top/guide/rules/register)、[声明](https://www.mcimirror.top/guide/rules/policy)。
- Java：清华 TUNA \`/Adoptium/{major}/jre/{arch}/{os}/\` 200（17/21/8、x64/aarch64、
  linux/mac/windows 齐全，文件名 \`OpenJDK{major}U-jre_{arch}_{os}_hotspot_*.tar.gz|zip\`）；
  华为云 openjdk 17 200；USTC Adoptium 17 404、腾讯云 Adoptium 404、网易 maven TLS 超时。
- GitHub release：gh-proxy.com 200（~700ms）、ghfast.top 200（~1.0s）、
  hk.gh-proxy.com 200（~1.2s）、ghproxy.net 403/超时、hub.gitmirror.com TLS EOF。
- 已死：MCBBS \`download.mcbbs.net\` TLS EOF；\`mod.tianpao.top\` TLS EOF。**不再接入**。

**先例（信条 3）**：[PCL2 ModDownload.vb](https://github.com/Meloong-Git/PCL)、
[Alicorn mirrors.ts](https://github.com/Andy-K-Sparklight/Alicorn)、
[Axolotl constants.rs](https://github.com/Axolotl-Launcher/Axolotl) 用的是同一套域名；
[HMCL](https://github.com/HMCL-dev/HMCL) 10953★ 但 **GPL-3.0 是硬约束**，只研究不合并。
PCL 为 NOASSERTION、Alicorn 为 GPL-3.0，均不合入本项目。

**决策**
1. **adopt 现状**：lycomc 已接 BMCLAPI（版本/库/资源）+ MCIM（Modrinth API）+ gh-proxy，
   覆盖 ≥80% 国内下载路径，按 anti-NIH 不换轮子、不重写下载器。
2. **局部补齐（本次做，低工时、可回退）**：默认源改 \`bmcl\`；
   Fabric meta/profile 与其 maven 库走 BMCL；Java 托管 JRE 优先清华 TUNA（linux/mac，
   失败回落官方 Adoptium）；Modrinth 文件 CDN 优先 MCIM；CFPA 汉化包多代理回落；
   UA 统一 \`lycomc/0.1\`（MCIM 要求的「名称/版本」格式）。
3. **不做（ROI 未过门槛）**：CurseForge 完整接入（新 API + 新 UI，工作量大且
   MCIM 明确「禁止二次封装」）、Forge/NeoForge/OptiFine 安装器（本项目无对应功能，
   接了也是死代码）、自搭反代（Prism 教程明确个人反代不应公开传播）。
4. **合规**：MCIM 要求接入登记启动器名与 UA，且「API 下载量不计入 Mod 开发者收益」
   「禁止二次封装」「公益服务，请不要攻击」；本站仅把 MCIM 作为用户可回落镜像，
   不二次封装、不对外提供镜像服务。登记属站点人工流程，记录为运维待办。
   汉化包仅运行时下载、绝不内嵌二进制（CFPA CC BY-NC-SA 4.0 / Sodium MIT）。

**验收**：每个改动有单元测试或真实 HTTP 200；release 构建通过；Web 全链路
（设置 / 装 Fabric / 装 Mod / 一键汉化 / 启动）实测；文档与 git 提交。

**联调新发现（已修，2026-11-11 傍晚）**：MCIM 的 `/project/{id}/version` 返回的项目列表
与官方条数相同（13 条），但**顺序过期**——官方把 `mc1.20.1-0.5.13-fabric`(2025-03-03) 排第一，
MCIM 却把它和 0.5.12-beta.2 追加在数组末尾，首位仍是 0.5.11(2024-06-29)。
原来 `pick_version` 直接取 `list.into_iter().next()`，镜像优先后就会静默装回一年前的旧 Mod
（实测装出 `sodium-fabric-0.5.11+mc1.20.1.jar`，与已有 0.5.13 并存会触发 Fabric 重复 mod id）。
修法：`ModVersion` 新增 `date_published` 字段，`newest_version` 按时间降序稳定排序后再取首位，
不再信任任何一方的数组顺序；新增回归单测 `newest_version_ignores_stale_mirror_order`（官方序/镜像乱序/空列表）。
教训 ⑦：**镜像的「结构一致」不等于「顺序一致」**，凡依赖排序的 API 都要用响应里的显式时间字段自己重排。

**实测补记**：清华 TUNA 托管 JRE 真机验证——用 `LYCOMC_DATA_DIR` 隔离数据根、伪造
`javaVersion.majorVersion=25`（本机无 Java 25），CLI `launch --dry-run` 走通
「本机缺 Java 25 → 已从国内镜像取得 → 已下载 58.9 MB → Java 25 就绪」，
落地 `java/25/bin/java` 报 `openjdk version "25.0.5" 2026-10-20 LTS`，192 MB；
后续因隔离根缺 libraries 而止步，与 JRE 下载路径无关。
Web 全链路（downloadSource=bmcl）实测：装 Fabric 1.4s、装 Mod 1.4s、一键汉化 2.1s、
启动 0.7s 全部 done，kill 后 `running=[]`。
