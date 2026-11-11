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
POST   /api/launch                     body {versionId, accountName, memoryMb?} -> {jobId}
POST   /api/launch/:pid/kill           -> {ok}
GET    /api/jobs/:id                   -> Job
GET    /api/events                     -> SSE: event: progress|done|error, data: Job
GET    /api/accounts                   -> {accounts:Account[]}
POST   /api/accounts                   body {name} -> Account
DELETE /api/accounts/:name             -> {ok}
GET    /api/modrinth/search?q=&versionId=&type=mod  -> {hits:[...]}
POST   /api/mods/install               body {versionId, projectId} -> {jobId}
GET    /api/mods?versionId=            -> {mods:[{file,name,size}]}
POST   /api/mods/remove                body {versionId,file} -> {ok}
GET    /api/settings                   -> Settings
PUT    /api/settings                   -> Settings（部分更新：只改请求体里出现的键，缺省字段保持原值；显式传 null 才清空 javaPath / selectVersion）
POST   /api/localize                   body {versionId} -> {jobId}（异步汉化：写 lang + 下载并启用汉化资源包，进度走 /api/events）
GET    /api/logs/:versionId            -> {lines:string[]}

## 类型
VersionInfo = {id, kind:"vanilla"|"fabric", baseVersion, installedAt, javaMajor, lang?, resourcePacks:string[], localized:bool}
JavaInfo = {path, version:number, source:"system"|"managed"}
Account = {name, uuid, kind:"offline"}
Settings = {memoryMb, javaPath?, extraJvmArgs[], selectVersion?, downloadSource:"mojang"|"bmcl", maxConcurrent, closeOnLaunch, gameLang:string}
// gameLang 默认 "zh_cn"，只允许 [a-z_]；启动前由 launch::prepare 写入实例 options.txt 的 lang 行
// downloadSource 默认 "bmcl"（国内镜像），已在磁盘上的 settings.json 不受默认值变更影响；"mojang" = 全官方直连
Job = {id, kind, title, state:"running"|"done"|"error", progress:0-100, message, logs[], result?, createdAt}

## 前端
- 路由：/ 主页（PCL 风大启动按钮）、/versions、/download、/mods、/settings
- 左侧固定竖栏 + 主内容区；中文；深色/浅色切换

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
- 2026-11-11 修 MCIM 版本列表顺序过期：`pick_version` 改按 `date_published` 降序挑最新（不再信任数组顺序），避免镜像优先时装回旧版 Mod。仅影响「装 Mod / 汉化包」选中的版本，API 形状不变。
