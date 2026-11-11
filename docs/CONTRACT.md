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
GET    /api/versions/:id               -> VersionInfo & {mods:[{file,name,size}], running:[{pid}]}
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
GET    /api/logs/:versionId            -> {lines:string[]}

## 类型
VersionInfo = {id, kind:"vanilla"|"fabric", baseVersion, installedAt, javaMajor}
JavaInfo = {path, version:number, source:"system"|"managed"}
Account = {name, uuid, kind:"offline"}
Settings = {memoryMb, javaPath?, extraJvmArgs[], selectVersion?, downloadSource:"mojang"|"bmcl", maxConcurrent, closeOnLaunch}
Job = {id, kind, title, state:"running"|"done"|"error", progress:0-100, message, logs[], result?, createdAt}

## 前端
- 路由：/ 主页（PCL 风大启动按钮）、/versions、/download、/mods、/settings
- 左侧固定竖栏 + 主内容区；中文；深色/浅色切换

## 变更记录
- 2026-11-11 PUT /api/settings 由「整体覆盖」改为「部分更新」。旧实现直接反序列化成 Settings，serde 的 default 属性会把缺省字段填回默认值，于是前端只提交 {selectVersion} 时会静默把 memoryMb 打回 4096、清空 extraJvmArgs。现改为 SettingsPatch（全 Option + apply 合并），与前端 saveSettings(patch) 的增量语义对齐。
- 2026-11-11 新增 GET /api/versions/:id（版本详情面板用，省掉整份 /api/state）。
