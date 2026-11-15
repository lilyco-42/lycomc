# PCL-CE 100% 功能差距 · 前端页面清点与 Web 设计建议

> task-1 / 前端负责人 ui / 2026-11-15。依据：`docs/PCL-COMPARISON.md` §3（41 项静态对比矩阵，2026-11-12）、`docs/PCL-CE-100-PLAN.md`（Round 1）、`docs/CONTRACT.md` 与 `web/src` 现状。本文是**前端交付建议 / 设计清点**，不代表已经实现，也不宣称 PCL-CE 100% 完成；不复制 PCL 的代码、商标、帮助原文或视觉资产。

## 1. 范围、基线与读数口径

1. `PCL-COMPARISON.md` §3 的统计为 ✅9 / 🟡16 / ❌14 / ➖2，共 41 项；它是对标 **PCL 原版 41 项清单的历史基线**，不是 PCL-CE 某个精确提交的完整功能边界。PCL-CE 具体版本/提交号尚未确定，所有 100% 结论必须等版本冻结后重新做差异测试。
2. 100% 的前端验收口径：每一项都要有**可从 Web 进入的入口**、完整交互（正常 / 空态 / 加载 / 错误 / 进度 / 成功）、可访问性标签与键鼠操作，以及重试与取消路径；不允许「CLI / MCP 有就算完成」。原型、占位按钮、纯链接、TODO 页面均不算交付。
3. 许可红线：PCL 原版 LICENCE 为 NOASSERTION 且含重度使用约束；只实现功能语义，不复刻原文案、图标、布局资源、帮助文件、配置名或 PCL 品牌。I40（WPF）与 I41（合规约束）按架构不适用处理，但 Web 仍须保持自有品牌与合规声明。
4. 矩阵时间差（写排期时必须扣除）：矩阵记录 A7 未拦截、B13 缺断点续传、G33 无自动加入、H39 无帮助；当前代码/契约已有 `POST /api/localize`、断点续传与慢流超时修复（O-6）、`quickPlayServer` + `POST /api/launch.server`（G33 部分实现）、`#/guide` 教程页。下文以「矩阵项 → 当前 Web 缺口」表述，避免重复开发。
5. 所有新增页面沿用自写 hash 路由（可刷新深链）、无新增依赖、严格 TypeScript、oxlint 0 error、`pnpm build`（tsc -b && vite build）成功、`web/dist` 为唯一构建产物；文案继续全中文、小白零术语、深/浅色可切换。

## 2. 现有 Web 能力地图（现状盘点）

| 面 | 现状 | 可复用资产 |
|---|---|---|
| 路由 / 导航 | `lib/router.ts` ROUTES = /, /versions, /download, /mods, /settings, /guide；`lib/nav.ts` 五项主导航同时驱动顶栏胶囊与 200px 左侧栏 | `hrefFor` / `navigate` / `useRoutePath`；新增页必须同步 ROUTES、NAV_ITEMS 与 App 路由表 |
| 全局状态 | `context/app-data-context.ts` 提供 settings / accounts / versions / running / javas / remote / health / loading / error / backendDown / reload / saveSettings / 当前版本与账号 | `app-data-provider.tsx` 单次聚合拉取；新页面不要各自重复拉 `/api/state` |
| 数据层 | `lib/api.ts` 同源 fetch、错误体 {error}、friendlyText() 大白话、ApiError.status=0 断连；`lib/use-sse.ts` + `lib/use-job.ts` 订阅 /api/events（按 jobId 过滤、断线重连、轮询兜底、进度只增、onFinished 单次） | 所有异步任务页统一用 useJobTracker + JobProgressCard，勿另造 SSE 实现 |
| 主页 / | 当前版本与账号、直连服务器、巨大启动按钮、Java/内存/下载源概览、远程最新版、运行状态、日志尾 80 行、结束进程 | LaunchButton、SkinAvatar、VersionAvatar、LauncherStatsCard、RemoteLatestCard、JavaStatusCard、LogTailCard |
| /versions | 实例列表、排序、详情展开（安装时间 / Java / 目录 / 语言 / 资源包）、设为当前、删除确认、一键汉化 | VersionRow / DetailRow / useVersionDetails / JobProgressCard |
| /download | 923 版本清单、搜索、typeFilter(release/snapshot)、分页 40、Fabric 开关、安装/重装、SSE 进度 | 版本清单卡与安装按钮可抽成公共 VersionPicker 供整合包/实例页复用 |
| /mods | Modrinth 搜索（去抖 400ms）、结果卡、按版本选最新、安装、已装列表/删除 | 资源卡骨架可扩展到 CurseForge/Shader/DataPack |
| /settings | 内存、Java 路径、JVM 参数、下载源、并发、语言、默认账号、直连服务器、启动后关闭、账号卡 | Slider / Select / Switch / AccountsCard / ErrorAlert |
| /guide | 四步图文 + 3 FAQ + 重看新手引导 | Onboarding（首启 `lycomc.onboarded`）、SectionHeader、折叠交互 |
| 共用状态 | PageTransition、Skeleton、EmptyState、ErrorAlert、BackendNotice、sonner toast、Tooltip、主题切换、BrandMark | 所有新页必须复用并呈现「加载 / 空 / 错 / 后端不可达」四态 |

## 3. 41 项逐项前端清点与交付建议

状态沿用矩阵：✅ 已覆盖、🟡 部分覆盖、❌ 未覆盖、➖ 架构不适用。优先级 P0–P5 对齐 `PCL-CE-100-PLAN.md`：P0 数据模型 → P1 账号与启动 → P2 资源与实例 → P3 联机帮助 → P4 UI/诊断 → P5 全量测试。标记「纯前端」表示不改契约即可交付其余依赖后端。

### A 账号与皮肤

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求（需 lead 落地） | 阶段 |
|---|---|---|---|---|
| A1 离线登录 | ✅ | 保持；AccountsCard 增加账号来源与创建时间说明，空态引导「先建一个游戏名字」 | 无 | 保持 |
| A2 微软正版登录 | 🟡 | 保留设备码对话框；增加「授权检查」状态行，`entitled=false` 置顶醒目且不阻断离线启动；设置页提供 SSL 证书校验开关与登录方式说明；缺本地回调/PKCE 需与后端方案联动 | `POST /api/auth/microsoft/start` 增 `mode: "device"|"local"` 与 `usePkce?:bool`；`Settings.microsoftSslVerify?:bool`；轮询结果返回 `entitled?:bool` | P1 |
| A3 Authlib-Injector | ❌ | 产品决策「不做」：不建页面；在 `#/guide` 常见问题说明「暂不支持第三方登录」，不误导用户 | 无（明确 out-of-scope） | 不排期 |
| A4 Nide8 | ❌ | 同上，帮助页合并说明 | 无（明确 out-of-scope） | 不排期 |
| A5 多账号切换 | 🟡 | AccountsCard 增加账号「类型 / 会话状态 / 是否默认」三列；首页下拉支持搜索与一键设默认；「记住密码」仅对支持站点提供勾选与保存状态指示，避免在 Web 存明文 | `Account.loginType?: "offline"|"microsoft"|"external"`；`POST /api/accounts/:name/remember` `{remember:bool}` | P1 |
| A6 皮肤展示 | ✅ | 保留 SkinAvatar + canvas 裁头 / 披风；新增皮肤预览弹窗（经典 / 纤瘦模型切换、刷新缓存按钮） | `POST /api/accounts/:name/skin/refresh` → {ok}（可选） | 保持 / P2 |
| A7 购买劝导 | 🟡 | 当前仅显示链接；把 `entitled=false` 的状态从 toast 提升为账号区持久提示「未检测到正版授权，请购买 Minecraft」+ 官方链接；按 PCL 语义在**正版账号**启动时前置确认（离线账号不受影响），确认框小白化 | `POST /api/launch` 返回 `{jobId, precheck?:{code:"NOT_ENTITLED", message}}` 或 409 明确错误体 | P1 |

### B 版本、加载器与下载

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求（需 lead 落地） | 阶段 |
|---|---|---|---|---|
| B8 版本清单 | ✅ | 保留搜索与 40/页；增加「正式版 / 快照 / 已安装」快捷筛选与排序（时间 / 编号） | 无 | 保持 |
| B9 客户端/资源下载 | ✅ | 保留 JobProgressCard；增加「暂停 / 继续」只在后端支持时显示，避免假按钮 | `POST /api/jobs/:id/pause|resume` → Job（可选） | 保持 |
| B10 7 种加载器 | 🟡 | /download 将「同时安装 Fabric」Switch 升级为 LoaderSelector：Fabric / Forge / NeoForge / OptiFine / OptiFabric / LiteLoader，按版本展示兼容矩阵与推荐 Loader；/versions 列表显示 Loader 图标与版本；不显示未支持组合 | `GET /api/loaders?versionId=` → `[{id,label,compatible,recommended}]`；`POST /api/versions/install` 增 `loader?:string, loaderVersion?:string`；VersionInfo 增 `loader?:string, loaderVersion?:string` | P1 |
| B11 手动安装 / 本地导入 | ❌ | 新增 `#/versions` 「从文件导入」Dialog：选择本地 .jar / .zip / HMCL/MMC 包，校验后展示识别到的版本与 Loader 再确认；SSE 进度、失败保留原因 | `POST /api/versions/import` multipart 或 `{path:string}` → {jobId}；`GET /api/versions/import/preview` | P2 |
| B12 下载源/线程/速度/文件名 | 🟡 | /settings 增加速度上限输入框（0=不限）与下载文件名格式下拉 + 示例；下载源旁显示大白话说明「国内加速 / 官方源」；并发保留现有 1–32 滑杆（后端 1–64） | `Settings.speedLimitKb?:number, fileNameFormat?:"original"|"version"|"indexed"` | P0（先契约） |
| B13 多源重试 / 镜像回落 | 🟡 | 任务卡显示「正在重试第 N 次 / 已切换备用线路」与失败明细折叠，不暴露域名；离线零术语文案 | `Job.result?` 增 `attempts?:number, mirror?:string, resumedBytes?:number`；`GET /api/jobs/:id` 同源 | P2 |
| C14 双平台搜索 | 🟡 | /mods 增加平台切换 Modrinth / CurseForge；结果卡统一 `ResourceHit` 模型（图标 / 作者 / 下载量 / 简介 / 平台徽标）；CurseForge 无 key 时显示「暂不可用」，不白屏 | `GET /api/curseforge/search?q=&versionId=&type=` → {hits:[ResourceHit]}；服务端保管 API key，前端不得内嵌 | P2（阻塞：API key） |
| C15 5 类资源 | 🟡 | 新增 `#/resources` 资源中心，Tab：Mod / 资源包 / 光影 / 数据包 / 世界 / 整合包；复用搜索卡、版本选择、安装按钮与 SSE；一键汉化入口保留在 /versions 并链接到资源包 Tab | `GET /api/resources/search?type=mod|resourcepack|shader|datapack|world|modpack&q=&versionId=` → {hits}；统一 `ResourceHit` | P2 |
| C16 版本匹配 / 依赖 | 🟡 | 资源详情抽屉展示「适用版本 / 所需前置 / 冲突项」；安装前勾选依赖并一次提交；无依赖时明确「无需额外组件」 | `GET /api/resources/:id/dependencies?versionId=` → `[{id,name,required,selected}]`；`POST /api/resources/install` 支持 `withDependencies:bool` | P2 |
| C17 本地 Mod 管理 | 🟡 | /mods 已装列表增加启用 Switch（映射到 `disabled/` 子目录）、「检查更新」按钮、详情抽屉（版本 / 依赖 / 文件哈希 / 更新时间）、「打开文件夹」按钮（桌面壳可用时；Web 退化为复制路径） | `POST /api/mods/:id/toggle` `{enabled:bool}`；`GET /api/mods/:id/info`；`POST /api/mods/:id/check-update` → `{latest,changelog}`；`POST /api/mods/open-folder` | P0（高 ROI） |
| C18 资源包等安装页 | 🟡 | 由 C15 `#/resources` 覆盖；资源包 Tab 显示「已启用 / 可启用」，安装后可一键启用写入 options.txt，复用现有汉化逻辑但通用化 | `POST /api/resources/:id/enable` `{versionId, enabled:bool}` → {ok} | P2 |
| C19 资源镜像 | ✅ | 保持；/settings 只显示「国内加速 / 官方源」大白话，不显示域名 | 无 | 保持 |

### D 整合包

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求（需 lead 落地） | 阶段 |
|---|---|---|---|---|
| D20 整合包导入 7 格式 | ❌ | 新增 `#/modpacks`：拖拽 .zip / 本地路径 / 粘贴分享码三种入口；导入前预览（名称 / 游戏版本 / Loader / Mod 数量 / 需确认的外部源）；导入任务走 SSE，完成后「去启动」 | `POST /api/modpacks/import` `{path?,code?}` → {jobId, preview?}；`GET /api/modpacks/import/preview`；7 种格式识别清单由 lead 定义 | P2（依赖 C15 资源模型） |
| D21 整合包导出 | ❌ | 实例详情增加「打包分享」按钮：选择包含存档 / Mod / 资源包、输出文件名，导出任务卡片；完成后「复制路径 / 打开文件夹」 | `POST /api/modpacks/export` `{versionId, include:[], fileName}` → {jobId}；`Job.result.path?:string` | P2 |

### E 实例管理

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求（需 lead 落地） | 阶段 |
|---|---|---|---|---|
| E22 实例管理 | 🟡 | /versions 行内「重命名」Dialog（即时校验、重名提示）、图标选择（内置图形，不复制 PCL 素材）、「版本隔离」Switch 与说明、复制实例入口；列表展示图标 + Loader 徽标 | `PATCH /api/versions/:id` `{displayName?, icon?, isolated?:bool}` → VersionInfo；VersionInfo 增同名字段 | P0（高 ROI） |
| E23 HMCL json 兼容 | ❌ | 与 B11 合并为「导入本地配置」Dialog；识别结果展示差异项并让用户确认，不静默覆盖 | `POST /api/versions/import-hmcl` `{path}` → {jobId} 或 preview + confirm | P2 |
| E24 实例级独立设置 | ❌ | 新增 `#/instances/:id`（或 /versions 展开二级页）：该实例的 Java、内存、JVM 参数、游戏语言、资源包、直连服务器、窗口参数；「跟随全局 / 单独设置」Switch；修改后只影响本实例 | `GET|PUT /api/versions/:id/settings` → InstanceSettings（字段语义对齐 Settings，含 `inheritFromGlobal:bool`） | P0（数据模型前置） |

### F 启动、Java 与诊断

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求（需 lead 落地） | 阶段 |
|---|---|---|---|---|
| F25 启动参数拼装 | ✅ | 保持；启动卡片增加「本次启动设置」可折叠预览（内存 / Java / Loader / 直连 / 语言），只读不暴露命令行术语 | 无 | 保持 |
| F26 Java 管理 | ✅ | 主页 JavaStatusCard 增加「检测新版本 / 下载托管 Java」按钮与状态；设置页 Java 路径提供校验反馈「这个 Java 可以用 / 版本太低」 | `POST /api/java/scan` → {javas}；`POST /api/java/install` `{major}` → {jobId}；`POST /api/java/validate` `{path}` → {ok, version} | P1 |
| F27 内存管理 | ✅ | 保留滑杆；增加大白话提示「内存给太多反而会卡」，并在超过物理内存 70% 时给出软提示，不阻止 | `GET /api/system/memory` → {totalMb, availableMb}（可选） | 保持 |
| F28 高级启动参数 | 🟡 | 设置页新增「高级启动」折叠区：启动前要执行的操作、窗口标题 / 大小 / 全屏、使用高性能显卡、GC 预设、禁用 JLW/LUA；分组呈现，默认全部关闭，小白不打扰 | `Settings` 增 `preLaunchAction?, windowTitle?, windowWidth?, windowHeight?, fullscreen?:bool, gpuPreference?:"auto"|"high", gcPreset?, disableJlw?:bool, disableLua?:bool` | P1 |
| F29 进程监控 | 🟡 | 保留运行卡 / 日志尾 / 结束进程；增加「查看窗口状态」（桌面壳可用时）与游戏退出后自动回收提示；Web 无窗口探测时显示「游戏已经关闭」即可 | `GET /api/running/:pid` → {pid,versionId,accountName,startedAt,windowTitle?,windowVisible?}；`POST /api/launch` 结果建议带 `pid` | P2 |
| F30 崩溃分析 | ❌ | 新增 `#/diagnostics`：启动失败后自动弹出结论卡「可能原因 + 3 个解决办法 + 查看日志」，按 44 类诊断映射为大白话；日志搜索 / 高亮 / 复制；不要求用户懂堆栈 | `POST /api/logs/analyze` `{versionId, logPath?}` → `{summary, causes:[{code,title,advice,severity}], matches:[]}`；诊断码表由 lead 提供 | P0（高 ROI） |

### G 联机（外部服务依赖重）

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求（需 lead 落地） | 阶段 |
|---|---|---|---|---|
| G31 房间 / 邀请码 | ❌ | 新增 `#/multiplayer`：创建房间（复制邀请码）、加入房间（输入邀请码）、成员列表与准备状态；所有错误提示小白化，房间码可复制 | `POST /api/rooms` → {code}；`POST /api/rooms/join` `{code}` → {room}；`GET /api/rooms/:code`；`DELETE /api/rooms/:code` | P3（阻塞：服务与凭据评审） |
| G32 EasyTier 组网 | ❌ | 同页「一起玩网络」开关：开启 / 关闭、状态、节点列表；不得在 Web 暴露底层端口 / IP 术语 | `POST /api/network/easytier` `{enabled:bool}` → {status}；`GET /api/network/status` | P3（阻塞：服务与凭据） |
| G33 服务器自动加入 | 🟡（矩阵 ❌，现 quickPlay 已部分实现） | 保留主页 / 设置页两个直连输入框；把队列 / 自动加入脚本做成 #/multiplayer 的「收藏的服务器」列表，点击即填入主页本次直连值 | `GET|POST|DELETE /api/servers` 收藏列表；`POST /api/launch` `server` 沿用现契约 | P3 |

### H 设置、帮助与个性化

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求（需 lead 落地） | 阶段 |
|---|---|---|---|---|
| H34 全局设置 | 🟡 | 按 PCL 192 键分组重构 /settings：常规 / 下载 / 启动 / 游戏 / 界面 / 高级，逐项中文说明与「恢复默认」；保留现 9 字段与 double_option 语义；新键先契约后 UI | `Settings` 扩展需 P0 数据模型冻结；`PUT /api/settings` 继续部分更新；`POST /api/settings/reset` `{scope?}` | P0（模型）/ P4（铺 UI） |
| H35 导入/导出设置/备份/清理 | ❌ | 新增 `#/backup`：导出设置 / 导入设置、一键备份、备份列表与恢复、清理缓存（显示可释放大小并二次确认）；操作均显示进度与成功状态 | `GET /api/settings/export`；`POST /api/settings/import`；`POST /api/backup/create` → {jobId}；`GET /api/backup/list`；`POST /api/backup/:id/restore`；`POST /api/cleanup` `{targets:[]}` → {jobId, freedBytes} | P4 |
| H36 UI 个性化 | 🟡 | 新增 `#/appearance`：主题色预设（青蓝 / 紫 / 暖色）、透明度、背景图、背景音乐、Logo 与首页欢迎语、动画速度、功能显示开关；所有项即时预览，保存后生效；不改 PCL 主题文件 | `Settings.ui?:{accent?:string, opacity?:number, background?:string, music?:bool, logo?:string, welcomeText?:string, animationSpeed?:"slow"|"normal"|"fast", hiddenFeatures?:string[]}` | P4 |
| H37 主题解锁 / 自更新 | ❌ | /settings「关于」区增加检查更新 / 下载更新 / 安装按钮、主题解锁入口（如有授权）；更新任务走 SSE，失败有重试，不强推 | `GET /api/updates/check` → {version,notes,asset?}；`POST /api/updates/install` → {jobId}；`POST /api/themes/unlock` `{code}` → {ok} | P3/P4（阻塞：签名密钥） |
| H38 提示 / 对话框 / 自定义事件 | 🟡 | 统一提示层：重点操作二次确认、危险操作红色确认、SSE 事件触发的「下载完成 / 游戏退出」轻提示、全局事件面板（可关闭）；避免弹窗轰炸，提供「不再提醒」 | `GET /api/notifications`；`POST /api/notifications/:id/read`；SSE 增 `event: notification`（沿用 /api/events） | P4 |
| H39 内联帮助 / 关于 | 🟡（矩阵 ❌，现 #/guide 已部分实现） | /guide 扩展每个功能页右上角「？」跳转锚点、术语表、关于页（版本 / 第三方许可 / 反馈 / 投票 / 用户协议）；所有原文重写为自有中文，不复制 PCL 文档 | `GET /api/about` → {version,licenses:[{name,text,url}],links}；`POST /api/feedback` `{content,contact?}` → {ok} | P0（高 ROI，纯前端可先做） |

### I 架构与合规

| 编号 | 状态 | 页面 / 组件 / 交互建议 | 契约新增请求 | 阶段 |
|---|---|---|---|---|
| I40 Windows WPF / 自绘控件 | ➖ | 不适用：Rust + lilyco 四前端 + shadcn Web 跨平台；桌面壳 / 托盘 / 快捷方式由 lead 负责，Web 只保证在壳内与浏览器一致 | 无 | 不排期 |
| I41 合规与工程约束 | ➖ | 不适用但须保持：自有品牌、许可声明入口（H39）、本地连接不暴露端口 / IP 文案、不复制 PCL 资产 | 无 | 不排期 |

## 4. 建议页面 / hash 路由与导航设计

> 所有新页必须同步 `lib/router.ts`、`lib/nav.ts` 与 `App.tsx`；左侧栏按「游戏 / 资源 / 联机 / 启动器」分组，主导航胶囊保持 5 项不变，避免小白迷路。每页顶部 PageHeader + SectionHeader，长列表用骨架屏，失败用 ErrorAlert + 重试按钮，后端不可达用 BackendNotice（大白话「正在连接启动器服务…如果很久没好，点这里重试」）。

| 路由 | 页面 | 核心内容 | 空 / 载 / 错 / 进度 / 成功态 |
|---|---|---|---|
| `#/` | 主页（保持） | 版本 / 账号 / 直连 / 启动 / 状态 / 日志尾；A7、F28 的提示入口 | 沿用现有；崩溃后自动切到诊断建议 |
| `#/versions` | 版本管理（扩展） | 列表 + 重命名 / 图标 / 隔离 / 导入 / 导出 / 实例设置入口 | 骨架 → 空态「还没有游戏版本，去下载」→ 错误重试 → 安装 / 导入进度 → 完成后「去启动」 |
| `#/instances/:id` | 实例设置（新） | 实例级 Java / 内存 / JVM / 语言 / 资源包 / 窗口 / 直连 | 骨架 → 跟随全局提示 → 错误重试 → 保存成功 toast；E24 |
| `#/download` | 下载（扩展） | 版本清单 + LoaderSelector + 兼容矩阵 + B12 设置入口 | 骨架 / 搜索空态 / 失败重试 / SSE 进度与重试提示 / 完成 |
| `#/resources` | 资源中心（新） | Mod / 资源包 / 光影 / 数据包 / 世界 / 整合包 Tab，统一搜索与详情抽屉 | 骨架 → 空态 → 平台不可用提示 → 安装依赖确认 → 安装完成 |
| `#/mods` | Mod 管理（扩展） | 已装列表 + 启用开关 / 更新 / 详情 / 打开文件夹 / 批量操作 | 骨架 → 空态「这个版本还没有 Mod」→ 错误重试 → 操作成功 toast |
| `#/modpacks` | 整合包（新） | 导入（拖拽 / 路径 / 分享码）+ 预览确认 + 导出 | 骨架 → 空态引导 → 格式不支持提示 → 导入进度 → 去启动 |
| `#/multiplayer` | 一起玩（新） | 房间 / 邀请码 / 收藏服务器 / 组网开关 | 骨架 → 空态「还没有收藏的服务器」→ 服务不可用提示 → 连接中 → 已加入 |
| `#/diagnostics` | 游戏诊断（新） | 失败结论卡 / 解决办法 / 日志搜索与复制 | 骨架 → 空态「最近没有发现问题」→ 分析失败重试 → 分析完成 |
| `#/backup` | 备份与清理（新） | 设置导入导出 / 备份恢复 / 清理缓存 | 骨架 → 空态「还没有备份」→ 错误重试 → 备份 / 清理进度 → 释放大小提示 |
| `#/appearance` | 外观（新，或并入 /settings） | 主题色 / 透明度 / 背景 / 音乐 / Logo / 动画 / 功能隐藏 | 即时预览 → 恢复默认二次确认 → 保存成功 toast |
| `#/guide` | 使用教程（扩展） | 分步图文 + FAQ + 术语表 + 内联锚点 + 关于 / 许可 / 反馈 | 折叠展开 → 搜索空态 → 反馈提交中 / 成功 |
| `#/notifications` | 消息中心（可选） | 全局提示历史与已读状态 | 骨架 → 空态 → 错误重试 → 标记已读 |

**组件拆分约定**：页面只编排数据，新增组件放 `web/src/components/`：loader-selector.tsx、resource-card.tsx、resource-detail-drawer.tsx、mod-row-actions.tsx、modpack-import-dialog.tsx、instance-settings-form.tsx、diagnosis-card.tsx、log-viewer.tsx、backup-list.tsx、appearance-panel.tsx、room-panel.tsx、about-panel.tsx、notification-center.tsx。所有表单控件沿用 `@/components/ui/*`；JobProgressCard 作为唯一任务进度呈现；Tooltip / aria-label / 键盘焦点必须覆盖新按钮与输入。

## 5. API 契约新增请求（建议清单，全部由 lead 统一落地）

> 下表只是前端期望，**不得由前端自行改后端或在 UI 造假数据**。已存在的 26 条路由沿用 `docs/CONTRACT.md`；请求 / 响应字段与错误体 `{error}` 保持一致，异步任务一律回 `{jobId}` 并走 `/api/events`。

| 领域 | 建议方法 / 路径 | 请求 | 响应 / 用途 |
|---|---|---|---|
| 实例 | `PATCH /api/versions/:id` | `{displayName?, icon?, isolated?:bool}` | 更新 VersionInfo（E22） |
| 实例 | `GET|PUT /api/versions/:id/settings` | InstanceSettings `{inheritFromGlobal, javaPath?, memoryMb?, extraJvmArgs?, gameLang?, quickPlayServer?, window*}` | 实例级设置（E24） |
| 实例 | `POST /api/versions/import`, `/import-hmcl`, `/import/mmc` | `{path?, code?}` 或 multipart | `{jobId}`（B11/E23） |
| 加载器 | `GET /api/loaders?versionId=` | — | `[{id,label,compatible,recommended}]`；`install` 增 `loader,loaderVersion`（B10） |
| 下载 | `Settings.speedLimitKb, fileNameFormat`；`POST /api/jobs/:id/pause|resume` | — | B12/B9 |
| 资源 | `GET /api/resources/search`, `/api/curseforge/search`, `GET /api/resources/:id/dependencies`, `POST /api/resources/install` | type / q / versionId / withDependencies | 统一 ResourceHit + 依赖勾选（C14–C18） |
| Mod | `POST /api/mods/:id/toggle`, `GET /api/mods/:id/info`, `POST /api/mods/:id/check-update`, `POST /api/mods/open-folder`, `DELETE /api/mods/batch` | `{enabled}` / `{files:[]}` | C17；避免前端直接改文件系统 |
| 整合包 | `POST /api/modpacks/import`, `/api/modpacks/export`, `GET /api/modpacks/import/preview` | `{path?,code?}` / `{versionId,include,fileName}` | `{jobId}` / preview（D20/D21） |
| Java | `POST /api/java/scan`, `/api/java/install`, `/api/java/validate` | `{major}` / `{path}` | Java 状态与校验（F26） |
| 启动 | `Settings.preLaunchAction*, window*, gpuPreference, gcPreset, disableJlw, disableLua`；`POST /api/launch` 结果带 `pid` | — | F28/F29；解决 kill 需猜 pid 的旧缺口 |
| 诊断 | `POST /api/logs/analyze` | `{versionId, logPath?}` | `{summary,causes,matches}`（F30） |
| 进程 | `GET /api/running/:pid`, `POST /api/accounts/:name/remember`, `POST /api/accounts/:name/skin/refresh` | — | A5/A6/F29 |
| 联机 | `POST /api/rooms`, `/join`, `GET/DELETE /api/rooms/:code`, `POST /api/network/easytier`, `GET /api/network/status`, `GET|POST|DELETE /api/servers` | `{code}` / `{enabled}` | G31–G33 |
| 设置 / 备份 | `POST /api/settings/reset`, `GET /api/settings/export`, `POST /api/settings/import`, `GET|POST /api/backup/*`, `POST /api/cleanup` | `{scope?}` / `{targets:[]}` | H34/H35 |
| 更新 / 帮助 | `GET /api/updates/check`, `POST /api/updates/install`, `POST /api/themes/unlock`, `GET /api/about`, `POST /api/feedback`, `GET /api/notifications` | — | H37–H39 |
| 既有缺口 | `GET /api/jobs` 历史；`Job.result.speedBps, pid, attempts, mirror`；`Job.state` 增 `canceled`；`POST /api/jobs/:id/cancel` | — | 任务中心 / 取消 / 速度 / pid；修正 `kill` 依赖猜测 |

**契约时间差提醒**：`quickPlayServer` 与 `POST /api/launch.server` 已在 `CONTRACT.md`；G33 在 11-12 矩阵记为 ❌，前端按**已实现**处理，只需补收藏列表。A7 的前置拦截还未进契约，需 lead 确认语义后再加 UI，不能自行拦截。

## 6. 优先顺序与 Web 可验收条件

| 阶段 | 交付内容 | 完成条件（可在 Web 上逐项点验） |
|---|---|---|
| P0 数据模型 + 高 ROI | 先冻结 InstanceSettings / ResourceHit / Settings 新键 / 诊断结构；落地 E22 重命名、C17 Mod 禁用、F30 诊断展示、H39 关于与许可、B12 速度上限；修既有契约缺口（jobs / pid / cancel） | /versions 可改名并显示；/mods 启用开关生效；失败后出现诊断结论；/guide 能看关于与许可；/settings 有速度上限；任务卡能显示速度与 pid |
| P1 账号与启动 | A2 授权前置与 SSL 开关、A5 类型展示、A7 正版前置确认、B10 加载器选择、F26 Java 校验、F28 高级参数 | 未授权正版账号启动前有确认；切换账号显示类型与会话；下载页可选兼容 Loader；Java 路径有可用 / 太低反馈；高级参数分组可保存 |
| P2 资源与实例 | B11 导入、C14 CurseForge（key 就绪后）、C15 资源中心、C16 依赖、D20/D21 整合包、E23/E24 实例设置 | 五种资源可搜索安装；依赖弹窗可勾选；整合包导入导出有进度；实例设置只影响该实例（后端断言） |
| P3 联机与帮助 | G31–G33 房间 / 组网 / 收藏服务器、H37 更新检查（签名就绪后） | 创建 / 加入房间有邀请码；组网开关有状态；收藏服务器一键填入主页直连；更新检查有版本说明 |
| P4 UI 深度与测试 | H34 设置分组、H35 备份清理、H36 个性化、H38 通知中心、P5 全量自动化 | 设置分组可搜索与恢复默认；备份可创建 / 恢复；外观即时预览；通知可已读；每页都有四态与键盘可达性测试记录 |

## 7. 风险与未决项

1. **PCL-CE 版本未冻结**：41 项来自 PCL 原版基线，PCL-CE 增减项未知；冻结后需重跑差异清点，本文按 PCL-CE-100-PLAN「不宣称 100%」执行。
2. **外部服务阻塞**：CurseForge API key、房间 / EasyTier 服务与凭据、自更新签名密钥、Windows/macOS 签名证书；未就绪时 UI 只显示「暂不可用 / 正在准备」，不做假入口。
3. **许可与品牌**：不复制 PCL 代码、图标、文档、主题文件；所有帮助文案重写为中文自有表达；第三方许可在 /guide 的关于页展示。
4. **小白零术语**：新页面不得出现端口 / IP / SSE / HTTP / 后端未就绪 / 堆栈等技术词；错误统一经 `friendlyText()` 转换，进度与重试说明只讲「下载 / 安装 / 启动 / 网络」。
5. **契约纪律**：所有新增字段先由 lead 落入 `CONTRACT.md` 与后端，再由前端接；禁止前端用 localStorage 假装保存实例设置 / 皮肤 / 资源状态（引导标记除外）。
6. **性能与范围**：新页面 13 个以上，必须共用 AppDataContext / useKeyedFetch / useJobTracker；新增依赖需单独评审，默认不引入 TanStack Query、antd、mui 等。
7. **构建护栏**：每个阶段提交前跑 `pnpm lint`（0 error）与 `pnpm build`（tsc -b && vite build），产物 `web/dist` 供后端 include_dir；不破坏现有 7 页与 PWA 入口。

## 8. 本次任务边界声明

本文由 ui 在 task-1 中独立撰写，**只新增 `docs/PCL-CE-GAP-FRONTEND.md` 一个文件**；未改 Rust / Cargo / CI / `TEST-EVIDENCE` / `TEST-REPORT` / `DECISION` / 既有历史证据，未改 `web/src`，未联网、未构建、未提交。所有 API 新增均为**建议请求**，须由 lead 评审并统一落地。
