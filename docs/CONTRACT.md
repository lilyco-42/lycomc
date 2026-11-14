# 前后端契约（不可单方面修改；改前先通知 lead）

## 数据根
~/.local/share/lycomc/
  settings.json
  accounts.json
  versions/<versionId>/          # 客户端实例（原版或 fabric-<ver>-<loader>）
    <versionId>.json             # 最终 version json（原版或已合并 fabric）
    <versionId>.jar              # 仅原版有；fabric 复用父版本 jar
    natives/
  libraries/                     # 全局库（maven 布局）
  assets/indexes + assets/objects
  java/<major>/                  # 托管 JRE
  logs/<instanceId>-<ts>.log

## HTTP API（axum，前缀 /api，JSON；错误体恒为 {"error":"..."}）
GET    /api/health                     -> ok,version,webMode,dataDir
GET    /api/state                      -> settings,accounts,versions[],running[],javas[],remote?
GET    /api/remote/versions?refresh=1  -> latest{release,snapshot}, versions[{id,type,releaseTime}]
POST   /api/versions/install           body {versionId, fabric?:bool} -> {jobId}
GET    /api/versions/:id               -> VersionInfo & {mods:[{file,name,size}], running:[{pid}], lang?, resourcePacks:string[], localized:bool}
DELETE /api/versions/:id               -> {ok}
POST   /api/launch                     body {versionId, accountName, memoryMb?, server?:string|null} -> {jobId}
POST   /api/launch/:pid/kill           -> {ok}
GET    /api/jobs/:id                   -> Job
GET    /api/events                     -> SSE: event: progress|done|error, data: Job
GET    /api/accounts                   -> {accounts:Account[]}（绝不包含 token）
POST   /api/accounts                   body {name} -> Account（新增离线账号）
DELETE /api/accounts/:name             -> {ok}
GET    /api/accounts/:name/skin        -> SkinInfo
POST   /api/accounts/:name/default      -> Settings（把已存在账号设为默认，写回 settings.json）
POST   /api/auth/microsoft/start       body {} -> {userCode,verificationUri,expiresIn,interval,message}（设备码只在内存，不下发）
POST   /api/auth/microsoft/poll        body {} -> {status:"pending",interval,message} | {status:"done",account:Account} | {status:"expired",message}
POST   /api/auth/microsoft/refresh     body {name} -> {account:Account}
POST   /api/auth/microsoft/logout      body {name} -> {ok}（清凭据、保留账号与皮肤缓存）
GET    /api/skin/image?url=&model=     -> image/png（同源代理；官方纹理失效/非法 URL 恒回退内置 Steve/Alex）
GET    /api/modrinth/search?q=&versionId=&type=mod  -> {hits:[...]}
POST   /api/mods/install               body {versionId, projectId} -> {jobId}
GET    /api/mods?versionId=            -> {mods:[{file,name,size}]}
POST   /api/mods/remove                body {versionId,file} -> {ok}
GET    /api/settings                   -> Settings
PUT    /api/settings                   -> Settings（部分更新：只改请求体里出现的键，缺省字段保持原值；显式传 null 才清空 javaPath / selectVersion / defaultAccount / quickPlayServer）
POST   /api/localize                   body {versionId} -> {jobId}（异步汉化：写 lang + 下载并启用汉化资源包，进度走 /api/events）
GET    /api/logs/:versionId            -> {lines:string[]}

## 类型
VersionInfo = {id, kind:"vanilla"|"fabric", baseVersion, installedAt, javaMajor, lang?, resourcePacks:string[], localized:bool}
JavaInfo = {path, version:number, source:"system"|"managed"}
Account = {name, uuid, kind:"offline"|"microsoft", hasSession:bool, entitled?:bool,
           skinUrl?, capeUrl?, skinModel?:"classic"|"slim", expiresAt?:number}
SkinInfo = {name, uuid, skinUrl?, capeUrl?, skinModel:"classic"|"slim",
            source:"microsoft"|"mojang"|"default", fallback:bool}
// accounts.json 落盘含 refreshToken / accessToken / expiresAt / xuid；Serialize 只输出上面这些公开字段，
// refreshToken / accessToken / xuid 绝不出现在任何 HTTP 响应、SSE 或 CLI 输出里。
// 写入时 accounts.json 强制 0600 + tmp→rename 原子提交（含凭据，禁止其它本地用户读取）；老文件需 chmod 600 回收。
// hasSession 仅表示「微软正版登录态是否有效」；离线账号恒为 false、无需登录且永远可启动。
// kind="microsoft" 且 hasSession=false 时 UI 才显示「需重新登录」；启动前后端自动 refresh，失败则明确报错。
// kind="microsoft" 且 entitled=false 时 UI 按 PCL 的购买劝导显示「未检测到正版授权，请购买 Minecraft」，不阻止离线启动。
Settings = {memoryMb, javaPath?, extraJvmArgs[], selectVersion?, downloadSource:"mojang"|"bmcl", maxConcurrent, closeOnLaunch, gameLang:string, defaultAccount?:string|null, quickPlayServer?:string|null}
// gameLang 默认 "zh_cn"，只允许 [a-z_]；启动前由 launch::prepare 写入实例 options.txt 的 lang 行
// defaultAccount = null 时启动缺省取账号列表第一项；PUT /api/settings 用 double_option 区分字段缺失与显式 null，显式 null 才清空可空字段
// downloadSource 默认 "bmcl"（国内镜像），已在磁盘上的 settings.json 不受默认值变更影响；"mojang" = 全官方直连
// POST /api/launch 的 server?:string|null 是「本次启动」覆盖值：字段缺失才回落 settings.quickPlayServer；
// 显式 null / 空串 / 非法地址都表示这次正常进主菜单，不改写默认值；合法值形如 host 或 host:port。
// Settings.quickPlayServer 是默认直连地址；None / 空串 = 正常进主菜单，保存时由 clean_server_address 白名单净化。
// 仅当版本元数据的 arguments.game 含 is_quick_play_multiplayer 规则时才注入 --quickPlayMultiplayer <addr>；
// 旧版本不追加未知选项，任务日志写「当前版本元数据不支持 quickPlay，已正常进主菜单」。
Job = {id, kind, title, state:"running"|"done"|"error", progress:0-100, message, logs[], result?, createdAt}


## 前端
- 路由：/ 主页（PCL 风大启动按钮）、/versions、/download、/mods、/settings
- 左侧固定竖栏 + 主内容区；中文；深色/浅色切换

- 主页启动区「直连服务器」与设置页「默认直连服务器」两个输入框；留空正常进主菜单，主页本次值会异步写回默认设置（2026-11-14 追加）。

## 下载源与镜像（downloadSource = "bmcl" 时生效）

- 所有 HTTP 请求统一 User-Agent lycomc/0.1（MCIM 要求「名称/版本」格式，禁止默认 UA）。
- Mojang 版本清单 / 版本 JSON / libraries / assets / Fabric meta / Fabric maven 库 → bmclapi2.bangbang93.com（失败自动回落官方域名，不写死 302 后的节点域名）。
- Modrinth 搜索/版本 API → mod.mcimirror.top/modrinth/v2，文件 CDN → mod.mcimirror.top/data/...（必须保留 /data/）；官方 API/CDN 仍作兜底。MCIM 为公益镜像，仅作用户可回落镜像、不做二次封装，接入登记（启动器名 lycomc / UA lycomc/0.1）为运维待办。
- 托管 JRE：Linux / macOS 且 downloadSource="bmcl" 时优先清华 TUNA /Adoptium/<major>/jre/<arch>/<os>/，用 gzip 魔数校验下载物，失败回落官方 Adoptium API；Windows 仍走官方。
- CFPA 汉化包：gh-proxy.com → ghfast.top → hk.gh-proxy.com → GitHub 直连，四级回落。
- 镜像行为只影响下载路径，不改变任何 API 形状；前端 downloadSource 类型仍为 "mojang"|"bmcl"。

## 变更记录
- 2026-11-11 PUT /api/settings 由「整体覆盖」改为「部分更新」。旧实现直接反序列化成 Settings，serde 的 default 属性会把缺省字段填回默认值，于是前端只提交 {selectVersion} 时会静默把 memoryMb 打回 4096、清空 extraJvmArgs。现改为 SettingsPatch（全 Option + apply 合并），与前端 saveSettings(patch) 的增量语义对齐。
- 2026-11-11 新增 GET /api/versions/:id（版本详情面板用，省掉整份 /api/state）。
- 2026-11-11 新增「一键汉化」契约：POST /api/localize；GET /api/versions/:id 返回 lang / resourcePacks / localized；Settings 增加 gameLang（默认 zh_cn）。汉化包仅运行时下载到实例 resourcepacks/，绝不内嵌进二进制（CFPA 包为 CC BY-NC-SA 4.0，Sodium 中文包为 MIT）。
- 2026-11-11 国内镜像源接入（决策 adopt 现状 + 局部补齐）：Settings.downloadSource 默认值由 "mojang" 改 "bmcl"；新增 Fabric meta/maven、清华 TUNA JRE、MCIM CDN 优先、CFPA 多代理回落、统一 UA lycomc/0.1。HTTP API 与类型形状不变，仅下载路径变化。详见「下载源与镜像」与 DECISION.md 末节。
- 2026-11-12 P0 补正版账号与皮肤：Account 扩展为 offline|microsoft + 公开会话/皮肤字段（凭据只落盘、不出口）；
  新增 /api/auth/microsoft/{start,poll,refresh,logout}（OAuth 设备码 → XBL → XSTS → Minecraft Services → 正版校验/角色）、
  GET /api/accounts/:name/skin 与 GET /api/skin/image（白名单 + PNG 校验 + 内置 Steve/Alex 兜底）；
  launch 对 kind="microsoft" 注入真实 accessToken / auth_xuid / userType=msa，离线仍用占位 token / legacy；
  CLI/TUI/MCP 启动前同样自动续期。client id 默认公开常量，可用 LYCOMC_MS_CLIENT_ID 覆盖。
  详见 DECISION.md「P0 补做：对照 PCL 的账号体系与皮肤展示」。
- 2026-11-11 修 MCIM 版本列表顺序过期：`pick_version` 改按 `date_published` 降序挑最新（不再信任数组顺序），避免镜像优先时装回旧版 Mod。仅影响「装 Mod / 汉化包」选中的版本，API 形状不变。
- 2026-11-13 新增默认账号：Settings 增加 `defaultAccount?:string|null`（旧 settings.json 缺省按 null 兼容）；新增 `POST /api/accounts/:name/default`，launch 与 CLI 缺省账号按 defaultAccount → 账号列表第一项 → Steve 解析；当前账号快速切换只保留在前端会话，不落盘。
- 2026-11-13 P0 契约修复：`PUT /api/settings` 的 javaPath / selectVersion / defaultAccount 三个可空字段改用 serde `double_option`，区分字段缺失（保持原值）与显式 JSON null（清空）。CDP 与可逆 HTTP 探针复验 13/13、9 次 PUT 语义通过；详见 docs/UI-MIGRATION.md §7 与 docs/DECISION.md「交互验收发现的 P0」。
- 2026-11-14 一键直连多人服务器（quickPlay）：POST /api/launch 增 `server?:string|null` 本次覆盖值（缺省才回落 `settings.quickPlayServer`，显式 null / 空串 / 非法值清空本次直连但不改写默认值）；Settings 增 `quickPlayServer?:string|null`，沿用 double_option 区分缺失 / 显式 null；CLI `lycomc launch` 增 `--server <地址>`。不新增端点、不新增依赖、不改 14 命令与 26 条 HTTP 路由；仅当版本元数据含 `is_quick_play_multiplayer` 规则时注入 `--quickPlayMultiplayer <addr>`。前端主页与设置页各增一个输入框，教程 / 图表 / 正版登录 / 皮肤 / SSE 均不回退。详见 DECISION.md「一键直连多人服务器」与 TEST-REPORT.md §10。
