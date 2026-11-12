# 原版 PCL 全量功能清单与 lycomc 逐项对比

> 决策日期：2026-11-12　|　目标：m02297「做好充分测试 对标原 PCL 所有功能 列出 PCL 的功能 做好对比 逐步OODA 完成」
> 证据来源：Meloong-Git/PCL 真实源码克隆 `/home/lilyco/.cache/pcl-src`（HEAD `93ede5d`，2.99.0.1 正式版），gh api 树 329 paths，Meloong-Git/PCLHelp 80 篇文档，PCL-Community/PCL-CE 作旁证。
> 本文只做**行为与公开协议对照**，不复制 PCL 的 `.vb` / `.xaml` / Images / Skins 资源；合规理由见第 1 节。

---

## 1. 合规前置（lyco 护栏：许可意识）

- `/home/lilyco/.cache/pcl-src/LICENCE` =《PCL 分发有限许可》+《PCL 存储库合理使用指南》，GitHub 标 `other`（NOASSERTION），**不是** MIT/Apache。**重度使用**（重新实现启动与下载 MC、管理 Mod 等）硬约束：① 明确标注第三方二次创作；② 名称必须以「Plain Craft Launcher (PCL)」开头加后缀；③ 关于页首位龙腾猫跃署名 + 赞助链接；④ 公开源代码；⑤ 与 `McLaunchPrecheck` 一致或更激进的正版购买劝导；⑥ Windows 主色相必须为蓝色。
- 决策：**不触发**该许可。lycomc / LilyCraft 沿用自有名称与视觉，仅对照功能行为、公开协议端点与设置语义；不复制任何 PCL 源码、UI 或图片资源。
- 先例仅作流程参照：HMCL-dev/HMCL、PrismLauncher、UNIkeEN/SJMCL 为 GPL-3.0，PCL-Community/PCL-CE 为 Apache-2.0 —— lycomc 的 OAuth 链路（devicecode→XBL→XSTS→Minecraft Services）按公开协议自研，不复制其源码。
- 结论：本节是 ROI 门槛的硬约束。**不因对标而移植 PCL 实现**，只把 PCL 当作功能清单与验收基线。

## 2. 原版 PCL 全量功能清单（9 大类 / 41 项）

清单由真实源码交叉验证：`Pages/PageSetup/Settings.vb` 共 **192 个 `New Setting(...)` 键**（前缀分组：Identify 1、Window 2、Hint 14、System 16、Cache 35、Login 9、Launch 27、Link 4、Tool 14、Ui 42、Version 26、其它 2）；`Pages/` 43 个 `.xaml` + 47 个 `.vb`；`Modules/` 18,906 行；`Controls/` 54 个自绘控件；`PCLCS/` C# 辅助与 JavaWrapper.jar / LwjglUnsafeAgent.jar；PCLHelp 80 篇用户文档。

### A. 账号与登录（Pages/PageLaunch/ 22 文件 + ModLaunch.vb 2221 行）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| A1 | 离线登录 + 自定义 UUID / 皮肤 | `PageLoginLegacy`、`McLoginLegacyUuidWithCustomSkin` |
| A2 | 微软正版登录（device code / 新 OAuth、刷新、SSL 证书验证、entitlements 购买校验、profile） | `PageLoginMs`、`MsLoginStep1New/1Refresh/2/3/4/5/6`、`McLoginMs` |
| A3 | Authlib-Injector 外置登录（自定义认证服务器、注册、邮箱密码） | `PageLoginAuth`、`LoginAuth*` 缓存键、`ModLaunch.vb` Prefetch |
| A4 | Nide8 统一通行证 | `PageLoginNide`、`-javaagent:nide8auth.jar`、`LoginNide*` |
| A5 | 记住密码 / 多账号切换 / 登录页类型 | `LoginRemember`、`LoginType`、`LoginPageType` |
| A6 | 皮肤展示与更换（头像裁切、披风、Alex/Slim、保存、导出、离线皮肤下载） | `MySkin`、`PageLoginMsSkin/AuthSkin/NideSkin`、`McSkinSelect/GetAddress/Download/Sex`、`LaunchSkin*` |
| A7 | 正版购买劝导（启动前置拦截） | `McLaunchPrecheck`：「你尚未购买正版 Minecraft，或者 Xbox Game Pass 已到期。」 |

### B. 版本下载与安装（PageDownload/ + ModDownload.vb 1388 行）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| B8 | 正式版 / 快照版版本清单（Mojang + BMCLAPI 双源） | `DlClientList`，逐字 `https://bmclapi2.bangbang93.com/mc/game/version_manifest.json` |
| B9 | 客户端 jar / assets / libraries 下载与修复 | `DlClientJarGet`、`DlClientAssetIndexGet`、`DlClientFix`（注：PCL 现版本因合规已移除 MC 下载，文案「为遵守相关法律法规，PCL 不再提供 MC 下载功能」） |
| B10 | 7 种加载器/附加项：Forge、NeoForge、Fabric、Fabric API、OptiFine、OptiFabric、LiteLoader | `PageDownloadInstall.xaml.vb:63` 卡片集合与 `Dl*List` |
| B11 | 手动安装 / 本地导入 `.minecraft` 文件夹 | `HintHandInstall`、`PageSelectRight`「添加文件夹」 |
| B12 | 下载线程数 / 速度上限 / 文件下载源 / 文件名格式 | `ToolDownloadThread/Speed/Source/ModLocalNameStyle`、`UpdateNetTaskSpeedLimitHigh` |
| B13 | 多源重试 / 并行下载 / 镜像回落 | `ModNet.vb` 1933 行 `NetRequestByClient/Retry/Multiple`、`NetSource/NetState` |

### C. Mod 与资源（Modules/Resource/ 5 文件 2290 行 + PageDownload/Resource/ + PageInstance/）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| C14 | CurseForge + Modrinth 双平台搜索、分页、按加载器过滤 | `ResourceSearcher.vb` `GetCurseForgeAddress/GetModrinthAddress` |
| C15 | 5 类资源：Mod / ModPack / ResourcePack / Shader / DataPack | `ResourceProject.vb` `ResourceTypes` 与 6 个资源详情页 |
| C16 | 版本匹配、发布类型、依赖解析 | `ResourceVersion.vb` `ReleaseTypes` / `Dependencies` |
| C17 | 本地 Mod 管理：缓存、指纹、更新、禁用、删除、信息、打开 | `LocalResourceFile.vb` (MurmurHash2 / SHA1)、`LocalResourceLoaders.vb` (`Cache/LocalMod.json`、`PageInstanceModDisabled`) |
| C18 | 资源包 / 光影 / 数据包 / 世界 / 整合包安装页 | `PageDownload{ResourcePack,Shader,DataPack,Pack}` + PCLHelp 对应教程 |
| C19 | 资源下载国内镜像 | `DlSourceModGet`、注释「MCIM 源不支持 URL 编码后的文件名」 |

### D. 整合包（ModModpack.vb 866 行）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| D20 | 7 种格式导入：CurseForge / Modrinth / HMCL / MMC / MCBBS / LauncherPack / Compress | `InstallPack*` 7 个函数 |
| D21 | 导出整合包 | `PageInstanceExport.xaml(.vb)` |

### E. 实例管理（PageInstance/ 14 文件 + ModMinecraft.vb 2153 行）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| E22 | 实例列表 / 选择 / 重命名 / 信息 / 图标 / 版本隔离 | `McInstance`、`PageInstanceOverall/Left/Setup` |
| E23 | HMCL 格式 version json 兼容 | `IsHmclFormatJson` |
| E24 | 实例级独立设置（26 个 `Version*` 键：JVM/游戏参数/资源/内存/窗口标题/Java 范围/服务器自动加入/GC/禁用 JLW·LUA） | `Settings.vb` `Version*` 分组 |

### F. 启动与进程（ModLaunch.vb + ModJava.vb + ModWatcher.vb + ModCrash.vb）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| F25 | 启动参数拼装（规则判定、classpath、natives、assets、登录态注入） | `McLaunchArgumentsJVM/ArgumentsGame`、`McJsonRuleCheck`、`McLibListGet` |
| F26 | Java 探测 / 手动导入 / 按需求选 / 自动下载 | `ModJava.vb` `JavaInit/ManuallyImportJava/GetJavaRequirement/SelectOrDownloadJava` |
| F27 | 内存管理（-Xmx、RamType、RamCustom、启动前内存优化） | `LaunchRamType/RamCustom`、`VersionRamOptimize` |
| F28 | 高级启动：启动前执行命令、窗口标题/大小/全屏、高性能显卡、GC 预设、禁用 JLW / LUA | `LaunchAdvance*`、`LaunchArgumentWindow*` |
| F29 | 进程监控：日志监听、进度、窗口探测、崩溃检测、结束进程 | `ModWatcher.vb` `Watcher/GameLog/ProgressUpdate/TryGetMinecraftWindow/Kill` |
| F30 | 崩溃分析（44 类原因自动诊断） | `ModCrash.vb` 1122 行 `CrashAnalyzer` + 44 个 `CrashReason` |

### G. 联机（PageLink/ + Link* 设置）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| G31 | 创建房间 / 加入房间 / 邀请码 / 房间人数 | `PageLinkMain.xaml(.vb)` |
| G32 | EasyTier 组网 / 延迟模式 / 自定义 Peer | `LinkEasyTierVersion/LatencyMode/CustomPeer`、`PathEasyTier` |
| G33 | 启动后自动加入服务器 | `VersionServerEnter` / `LinkLastAutoJoinInviteCode` |

### H. 设置与个性化（PageSetup/ 12 文件 + Settings.vb 192 键 + 基础模块）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| H34 | 全局设置（内存、Java、下载源、线程、JVM 参数、缓存、正式/快照更新通道、匿名遥测） | `Tool*` / `SystemSystemTelemetry` / `Ui*` |
| H35 | 导入 / 导出设置、备份、清理垃圾 | `PageSetupSystem.xaml`、`CacheExportConfig`、`HintClearRubbish` |
| H36 | UI 个性化：透明度/色相/饱和度/亮度/主题/背景图/背景音乐/Logo/主页预设/自定义首页 XAML/动画速度/功能隐藏 | `Ui*` 42 键、`ModMusic.vb` 347 行 |
| H37 | 主题解锁（赞助码）、启动器自更新 | `ModSecret.vb` `ThemeUnlock/UpdateReplace/DownloadLatestPCL/GeneratePotatoCode` |
| H38 | 提示系统 / 对话框 / 自定义事件 | `Hint*` 14 键、`ModMain.vb` `MyMsgBox*`、`ModEvent.vb` `CustomEvent` |
| H39 | 内联帮助 / 关于与鸣谢 / 第三方许可 / 反馈 / 功能投票 / 百科 | `PageOther*`、PCLHelp 80 篇、`HintNotice` |

### I. 平台与工程（架构层，非用户功能）
| 编号 | 功能 | 源码证据 |
|---|---|---|
| I40 | Windows 原生 WPF / VB.NET、54 个自绘控件、动画模块、PCLCS C# 辅助 | `Controls/`、`ModAnimation.vb` 1066 行、`PCLCS/` |
| I41 | 合规与工程约束：EULA、调试模式、F12 显示隐藏功能、蓝色主色相、署名 | `LICENCE`、`SystemEulaVersion`、`UiHiddenFunctionHidden` |

---

## 3. PCL vs lycomc 逐项对比矩阵

图例：✅ 已覆盖并可验收　🟡 部分覆盖　❌ 未覆盖　➖ 架构不适用（lycomc 为 Rust + Web 跨平台，非 Windows WPF）

| 编号 | PCL 功能 | lycomc 状态 | lycomc 实现与证据 |
|---|---|---|---|
| A1 | 离线登录 | ✅ | `settings::Account::offline` + `mc::offline_uuid`（自写 MD5），`--accessToken` / `--userType legacy` 注入；CLI/Web/TUI/MCP 一致 |
| A2 | 微软正版登录 | 🟡 | 自研 `mc/auth.rs`：devicecode→token 轮询→XBL→XSTS→`login_with_xbox`→entitlements→profile；`start/poll/refresh/logout` 4 路由。**缺**：本地回调 / PKCE、SSL 证书开关、entitlements=false 的前置拦截 |
| A3 | Authlib-Injector 外置登录 | ❌ | 决策明确不做（DECISION.md P0 章节） |
| A4 | Nide8 统一通行证 | ❌ | 决策明确不做 |
| A5 | 多账号切换 | 🟡 | 账号列表 + 首页/设置页下拉选择 + 默认取第一项；**缺** 记住密码、登录页类型 |
| A6 | 皮肤展示 | ✅ | `GET /api/accounts/:name/skin`（正版 profile / 离线查 Mojang / 内置 Steve·Alex 兜底）、`/api/skin/image` 同源白名单代理（SSRF 拦截）、前端 canvas 裁头 8,8,8,8 + 帽层 40,8,8,8、皮肤预览与披风链接 |
| A7 | 正版购买劝导 | 🟡 | 前端 `entitled=false` 时显示「未检测到正版授权，请购买 Minecraft」+ minecraft.net 链接；**不拦截启动**（与 PCL 的 `McLaunchPrecheck` 前置校验不同） |
| B8 | 版本清单 | ✅ | `GET /api/remote/versions` 923 个版本（正式 103 / 快照 759 / 全部 923），前端搜索 + 分页 40 |
| B9 | 客户端/资源下载 | ✅ | `mc/install.rs` 装 1.20.1 = 3600 文件 / 623.9 MB，含 jar、libraries、natives、assets；PCL 反而因合规移除该功能 |
| B10 | 7 种加载器 | 🟡 | **仅** Fabric + Fabric API（`mc/fabric.rs` 父链合并、`install::merge` 无条件覆盖 `mainClass`、natives 补齐）；缺 Forge/NeoForge/OptiFine/OptiFabric/LiteLoader |
| B11 | 手动安装 / 本地导入 | ❌ | 无 |
| B12 | 下载源/线程/速度/文件名 | 🟡 | `downloadSource: mojang|bmcl`、`maxConcurrent` 1–64 sanitize；**缺** 速度上限、文件名格式 |
| B13 | 多源重试 / 镜像回落 | 🟡 | `mc/download.rs` 并发下载 + `BMCLAPI / MCIM / TUNA / CFPA / gh-proxy` 镜像回落；**缺** PCL 的 `NetRequest Retry/Multiple` 语义与断点续传 |
| C14 | 双平台搜索 | 🟡 | **仅** Modrinth（`/api/modrinth/search` 去抖 400ms + 按实例版本过滤）；缺 CurseForge |
| C15 | 5 类资源 | 🟡 | Mod + 一键汉化中文资源包（CFPA + Sodium 汉化包）；缺 Shader / DataPack / 世界 / 整合包浏览 |
| C16 | 版本匹配 / 依赖 | 🟡 | Modrinth 版本按 `game_versions` 过滤、按 `date_published` 降序挑最新（修过 MCIM 顺序过期 bug）；**缺** 依赖自动解析 |
| C17 | 本地 Mod 管理 | 🟡 | 列表 / 安装 / 删除（Web + CLI + MCP）；**缺** 禁用子目录、指纹更新、信息页、打开文件夹 |
| C18 | 资源包等安装页 | 🟡 | 一键汉化把中文资源包写入 `options.txt` 的 `resourcePacks`；无通用资源浏览下载页 |
| C19 | 资源镜像 | ✅ | BMCLAPI / MCIM CDN / TUNA Adoptium / CFPA gh-proxy 多代理，实测 200；MCBBS / mod.tianpao.top / USTC Adoptium 实测不可用 |
| D20 | 整合包导入 7 格式 | ❌ | 无 |
| D21 | 整合包导出 | ❌ | 无 |
| E22 | 实例管理 | 🟡 | 列表 / 详情（语言、资源包、已汉化）/ 设为当前 / 删除 / 启动 / 一键汉化；**缺** 重命名、图标、版本隔离 |
| E23 | HMCL json 兼容 | ❌ | 无（仅读本地父链 `inheritsFrom` 合并） |
| E24 | 实例级独立设置 | ❌ | 仅全局 `Settings` 9 字段 |
| F25 | 启动参数拼装 | ✅ | `mc/launch.rs` 规则展开、classpath、natives、assets、log4j、`--accessToken` 按 kind 注入；Fabric 实例父链合并 + natives 补齐；真实启动进主菜单 |
| F26 | Java 管理 | ✅ | `mc/java.rs` 扫描 5 个系统 JRE、按 `javaMajor` 选、缺失时从 TUNA Adoptium 下载（隔离测试真实下过 58.9 MB openjdk 25.0.5）；`javaPath` 可手填 |
| F27 | 内存管理 | ✅ | `memoryMb` 256–65536 sanitize → `-Xmx{}M` |
| F28 | 高级启动参数 | 🟡 | `extraJvmArgs`（如 `-XX:+UseG1GC`）；**缺** 启动前执行命令、窗口标题/大小/全屏、高性能显卡、GC 预设、禁用 JLW / LUA |
| F29 | 进程监控 | ✅ | `running[]` + pid + 日志尾 80 行 + SSE 进度 + `/api/launch/:pid/kill` + `reap` 回收；**缺** 游戏窗口探测 |
| F30 | 崩溃分析 | ❌ | 仅 `GET /api/logs/:versionId` 日志尾，无 44 类自动诊断 |
| G31 | 房间 / 邀请码 | ❌ | 无 |
| G32 | EasyTier 组网 | ❌ | 无 |
| G33 | 服务器自动加入 | ❌ | 无 |
| H34 | 全局设置 | 🟡 | 9 字段（`memoryMb/javaPath/extraJvmArgs/selectVersion/downloadSource/maxConcurrent/closeOnLaunch/gameLang` + 版本）；PCL 有 192 键 |
| H35 | 导入/导出设置/备份/清理 | ❌ | 无（settings.json 可直接编辑并 sanitize） |
| H36 | UI 个性化 | 🟡 | 深浅色主题 + PCL 风 200px 左栏 + skeleton/空态/错误态；**缺** 透明度/色相/背景图/背景音乐/Logo/主页 XAML/动画速度/功能隐藏 |
| H37 | 主题解锁 / 自更新 | ❌ | 无 |
| H38 | 提示 / 对话框 / 自定义事件 | 🟡 | sonner toast + SSE Job 进度卡 + 设备码对话框；**缺** PCL 的 14 个 `Hint*`、MyMsgBox 体系、CustomEvent |
| H39 | 内联帮助 / 关于 | ❌ | 仅 404 兜底页；无内联文档、关于、第三方许可、反馈、投票 |
| I40 | Windows WPF / 自绘控件 | ➖ | lycomc 采用 Rust + lilyco 四前端 + shadcn Web（跨平台），架构不同 |
| I41 | 合规与工程约束 | ➖ | lycomc 沿用自有名，不触发 PCL 重度使用条款；`denyElevated` / `LocalOnly` / `Agent` 三级安全策略 |

### 统计

| 状态 | 项数 | 占比 |
|---|---|---|
| ✅ 已覆盖 | 9 | 22% |
| 🟡 部分覆盖 | 16 | 39% |
| ❌ 未覆盖 | 14 | 34% |
| ➖ 架构不适用 | 2 | 5% |
| **合计** | **41** | **100%** |

**核心启动链路（版本下载 → Java → 参数拼装 → 启动 → 进程/日志、账号 → 皮肤、Mod → 镜像、设置持久化）已全链路覆盖并实测**；差距集中在「PCL 的 Windows 桌面生态层」：多加载器、CurseForge、整合包、外置登录、联机组网、崩溃诊断、深度个性化。

## 4. OODA 轮次记录（逐步）

| 轮次 | 阶段 | 动作 | 产出 |
|---|---|---|---|
| O-1 | Observe | 读目标；`cn.bing.com` 搜「原 PCL / PCL-CE 区别」满足理解门槛(a)；`ask_user_question` 询问对标范围（门槛(b)，超时未答，按「清单+对比+测试」收敛）；gh 4 轮同义词搜索 + `gh api trees recursive` | 确认基线 = Meloong-Git/PCL 原版（9658★），旁证 PCL-CE / PCLHelp；真实仓库 URL 全部来自 gh 结果 |
| O-2 | Orient | `git clone --depth 1` 原版源码；统计 329 paths / 192 设置键 / 18,906 行模块 / 43+47 Pages / 80 篇帮助文档；读 LICENCE 硬约束；比对 lycomc 25 路由 / 14 命令 / 9 设置 / 15 单测 / 6 前端页 | 第 2 节功能清单、许可结论、lycomc 现状基线 |
| O-3 | Decide | ROI 门槛：对照 PCL 许可（NOASSERTION 重度使用 6 条硬约束）与工作量，决策 = **adopt 现状 + 全量对比 + 充分测试报告 + 差距清单**，不移植 PCL 代码、不擅自补齐 14 项缺失（用户未给范围/预算）。仅对测试发现的真实缺陷做最小化修复 | 决策记录于本文 + `DECISION.md`；修复 1 个契约不一致 |
| O-4 | Act | 7 层测试（单元 / CLI / MCP / Web / 前端 CDP / TUI PTY / 真实 E2E + 边界）；发现 `clear_session` 对离线账号误返 200 → 修为 400 明确拒绝；`cargo test` + `cargo build` + 重启服务 + 真实复验 | `docs/TEST-REPORT.md` 证据矩阵（L1–L7）；`src/settings.rs` 补丁；截图 6 张；`docs/TEST-EVIDENCE.json` 校验和索引 |
| O-5 | Loop / Verify | 复跑 15/15 单测、29 个 HTTP 探针、6 页 0 skeleton、真实 JVM launch→kill、设置往返、镜像/汉化/Mod 全链路 | 本轮闭环；下一轮候选见第 5 节 |
| O-6 | Loop（用户实测 P0） | 用户报 26.3 安装 100% 失败 `error decoding response body`；curl 实测 41 MB 需 165 s / 250 KB/s，`.part` 恰停 13.4 MB ≈ 60 s → 根因 = `meta::client()` 的 60 s 总超时截断慢流；修为连接/读空闲超时 + Range 断点续传 + 2 个回归单测；后台 `systemd-run` 真装 41,483,720 B、sha1 与 version JSON 一致 | `docs/TEST-REPORT.md` §3；`src/mc/meta.rs`、`src/mc/download.rs`；17/17 单测 |

## 5. 差距清单与下一轮 ROI 建议（未授权实现，仅候选）

- **高 ROI / 低许可风险**：F30 崩溃日志关键字诊断（只读日志，纯前端+后端规则表）、E22 实例重命名、C17 Mod 禁用子目录、H39 关于页与第三方许可（顺带满足开源合规）、B12 下载速度上限。
- **中 ROI**：C14 CurseForge 搜索、C15 资源包/光影/数据包浏览、D21 整合包导出（只读打包，风险低）、F28 窗口标题/大小。
- **低 ROI / 高风险或大工作量**：A3/A4 外置登录（Authlib-Injector 需注入 javaagent，合规敏感）、G31–G33 联机组网（需 EasyTier 二进制分发）、B10 Forge/NeoForge/OptiFine 全加载器（每个都是独立安装器协议）、D20 7 种整合包格式、H36/H37 深度个性化与自更新。
- **PCL 许可触发项**：若未来要把 lycomc 定位成「PCL 二次创作」，须同时满足 6 条硬约束（改名以 PCL 开头、关于页首位署名 + 赞助链接、蓝色主色相、购买劝导、公开源码）；当前决策是**不触发**。

> 本轮「完成」的边界：按 lyco 护栏，用户目标动词为「做好充分测试 / 对标 / 列出 / 做好对比 / 逐步 OODA 完成」，交付物是**全量清单 + 逐项对比 + 充分测试证据 + 差距与 ROI 决策**，而非把 14 项缺失功能全部实现。功能补齐需用户在下一轮明确 ROI 范围。
