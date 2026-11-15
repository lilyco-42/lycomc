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

## P0 补做：对照 PCL 的账号体系与皮肤展示（决策 2026-11-12）

**触发**：用户 m01841「P0: 你没有 对比 PCL 实现 用户 也没有 正版登陆和皮肤展示等」；m01891「继续」授权实现。
此前只做了版本/Mod 下载与启动四端，没做「账号」这一层，确实不算「PCL 类似」。

### 对比矩阵（真实源码对照，不是凭印象）

| PCL 能力 | PCL 实现位置 | lycomc 之前 | 本次决策 |
| --- | --- | --- | --- |
| 离线账号 | PageLoginLegacy / ModLaunch | 有（accounts.json，OfflineAccount） | 保留、不回退 |
| 微软正版登录（设备码） | PageLoginMs + MyMsgLogin + McLoginMsLoader | 无 | 自研 Rust 实现设备码流程 |
| 刷新 token / 退出登录 | PageLoginMsSkin.BtnExit / CacheMsV2* | 无 | 落盘 refresh/access，提供刷新与退出 |
| 正版校验（entitlements） | McLoginMsLoader / McLaunchPrecheck | 无 | 登录时查 entitlements/mcstore |
| 皮肤/披风预览 | MySkin.xaml.vb（裁头 40,8 + 叠加层） | 无 | 皮肤代理 + canvas 头像 + 立绘 |
| 更换/保存皮肤 | PageLoginMsSkin.EditSkin | 无 | 不做（需要上传，ROI 低，先展示） |
| 外置登录（Nide8 / Authlib-Injector） | PageLoginAuth / PageLoginNide | 无 | 不做（第三方认证服务器，需注入 javaagent，ROI 未过门槛） |
| 账号多开/切换 | PageLoginMs.ComboAccounts + LoginMsJson | 单离线列表 | 复用 accounts.json，kind 区分 |
| 版本/Fabric/Mod 下载、中文、镜像、四端、设置、日志 | ModDownload / ModLaunch 等 | 已覆盖 | 保持 |
| 崩溃分析 / 整合包 | ModCrash / ModModpack | 无 | 不做（本次聚焦账号与皮肤） |

### 先例与合规（信条 1/3/4，全部真实 gh 结果）

- PCL Meloong-Git/PCL（NOASSERTION，9653★）：LICENCE 的《PCL 存储库合理使用指南》规定「重度使用」（重新实现启动/下载 MC、管理 Mod 等）需：第三方二次创作署名、名称以 PCL 开头、关于页龙腾猫跃署名+赞助、开源、正版购买劝导、Windows 主色相蓝色。**决策：只对照行为与公开协议，绝不复制 PCL 的 .vb/.xaml 代码、UI 与 Images/Skins 皮肤资源**，避免落入重度使用约束；且我们沿用自有名称 lycomc/LilyCraft，不混淆。
- HMCL-dev/HMCL（GPL-3.0）、PrismLauncher（GPL-3.0）、UNIkeEN/SJMCL（GPL-3.0）：只对照公开协议端点与流程（Microsoft OAuth device code → Xbox Live → XSTS → Minecraft Services → profile），**不复制任何 GPL 源码**。
- PCL-Community/PCL-CE（Apache-2.0）：可作行为参考，同样不搬代码。
- client id：PCL 开源版 ModSecret.vb 明确 OAuthClientId 来自环境变量 PCL_MS_CLIENT_ID（默认空，安全代码已删）；HMCL client id 空时抛 MicrosoftAuthenticationNotSupportedException。实测社区公开 Azure 应用 id b2468fd2-7996-4f42-8857-5b65d834ef5c（来自 SJMCL 开源常量）POST devicecode 返回 200，而乱猜的 0000000048183522 返回 AADSTS700016。**决策：默认用该公开常量兜底保证开箱可用，但优先读 LYCOMC_MS_CLIENT_ID 环境变量，并在 UI/文档写明「生产请注册自己的 Azure 应用」**——只引用一个 Azure 注册 id，不含 GPL 代码。

### 技术决策（最小可行，原子化）

1. 新增 src/mc/auth.rs：标准 HTTP 流程，自研 structs/解析，不依赖任何启动器源码。端点：login.microsoftonline.com/consumers/oauth2/v2.0/{devicecode,token}、user.auth.xboxlive.com、xsts.auth.xboxlive.com、api.minecraftservices.com/{authentication/login_with_xbox,entitlements/mcstore,minecraft/profile}、sessionserver.mojang.com、api.mojang.com。
2. settings.rs 的 Account 扩展：kind=offline|microsoft，新增可选 refreshToken/accessToken/expiresAt(ms)/xuid/skinUrl/capeUrl/skinModel/entitled（全部 serde default，兼容旧 accounts.json）；新增 save/update helpers。
3. mc/launch.rs：离线账号仍用离线 token；microsoft 账号注入真实 accessToken、auth_xuid、userType=msa、auth_session=token。保持离线不回退。
4. api.rs 新增：POST /api/auth/microsoft/start（同步取 device code，只返回 userCode/verificationUri/interval/expiresIn；device_code 留内存不下发）与 POST /api/auth/microsoft/poll（单次轮询，pending/授权完成则落盘账号）、POST /api/auth/microsoft/refresh、POST /api/auth/microsoft/logout、GET /api/accounts/{name}/skin、GET /api/skin/image?url=…（同源图片代理，失败回退默认 Steve/Alex）。设备码轮询放前端定时调用，避免长期后台 job 与状态泄漏。
5. 皮肤：正版账号用登录缓存的 profile textures；离线账号按名字查 api.mojang.com → sessionserver 的 textures（真实正版名可查到，如 Notch）；texture URL 实测可能 404（旧纹理下线），代理必须容错回退内置默认皮肤，绝不因皮肤失败影响启动。皮肤立绘/头像用前端 canvas 从同源代理图裁切，规避 CORS。
6. 前端（shadcn）：设置页账号区加「微软正版登录」按钮 + 设备码对话框（显示 userCode、复制、打开验证页、轮询进度、完成/失败提示）；账号行加 kind 徽章与皮肤头像；主页左栏「当前账号」显示皮肤立绘/头像。
7. 明确不做（ROI 未过门槛）：Authlib-Injector/Nide8 外置登录、皮肤上传更换、崩溃分析、整合包。

### 验收

cargo test（解析逻辑单测：device code / XBL / XSTS / MC token / textures base64）通过；devicecode start 真实 200 拿到 userCode；皮肤 API 对 Notch 返回 textures、图片代理 200、对不存在名回退默认皮肤；launch 对 microsoft kind 账号 dry-run 命令行含真实 accessToken 与 userType=msa、离线账号仍含离线 token；Web 能打开登录对话框并完成皮肤展示；文档与 git 提交。

### 实现与实测（2026-11-12 中午）

- 后端已按上述决策落盘：src/mc/auth.rs（设备码 / OAuth token 轮询 / XBL / XSTS / Minecraft Services / entitlements / 角色皮肤）、settings.rs 的 Account 扩展与凭据只落盘、mc/mod.rs 的 GameAccount、launch.rs 的真实 token 注入、api.rs 的 6 条新路由与同源皮肤代理；CLI/TUI/MCP 启动前同样自动续期。
- `cargo test` 15/15 通过（新增 8 个 auth 离线单测：设备码字段、OAuth 错误分类、协议字符串、profile 皮肤 variation、textures base64、内置 PNG、SSRF 白名单、token 序列化不泄露）；`cargo build` 通过。
- 真实网络：`POST /api/auth/microsoft/start` 200 拿到 userCode 5VQPZDVT / interval 5 / expiresIn 900；`POST /api/auth/microsoft/poll` 返回 status=pending；`GET /api/accounts/Steve/skin` 200（source=mojang，真实 Mojang 皮肤/披风 URL）；`GET /api/skin/image?model=classic` 200 image/png 1350 B；传入 127.0.0.1 SSRF URL 也只回内置 PNG；真实 Steve 纹理 3108 B，失效 Notch 纹理回退 1350 B。
- 伪造 microsoft-kind 账号 dry-run：`--accessToken MSATESTTOKEN`、`--userType msa`、`--uuid` 为正版 UUID、离线占位 token 消失；`/api/accounts` 与 `/api/state` 均不含 MSATESTTOKEN / MSATESTREFRESH / xuid；伪造 refresh token 走真实微软 token 端点得到 AADSTS70000 并给出「请重新进行微软正版登录」提示。离线 Steve dry-run 仍是占位 token + legacy + 空 xuid，无回退。
- 说明：1.20.1 的官方参数模板没有 `${auth_xuid}` / `${auth_session}` 占位，所以 xuid/session 不会出现在该版本命令行；vars 已按 kind 填好，较新版本模板含占位时会自动生效。正版启动的最小必需集是真实 accessToken + userType=msa + 正版 UUID，已满足。
- 前端（ui teammate）并行实现设备码对话框、皮肤头像与账号徽章；完成后需重新 pnpm build → cargo build 嵌入新 dist，再做浏览器截图验收。
- 凭据落盘安全复查：accounts.json 现含 refresh/access token，`save_accounts` 改为 OpenOptions 0600 创建 + write_all/sync_all + 原子 rename（src/settings.rs），隔离 LYCOMC_DATA_DIR 实测新文件 600、旧生产文件已 chmod 600；cargo test 15/15 与 cargo build 复验通过。

### 前端落地与全链路验收（2026-11-12 下午，P0 收尾）

- ui teammate 交付 shadcn 前端：web/src/lib/api.ts / normalize.ts / account-skin.ts、components/skin-avatar.tsx（canvas 裁 64x64 头+帽层、同源 /api/skin/image 代理、失败回退 /steve.png 或 /alex.png）、components/microsoft-login-dialog.tsx（设备码、验证页、倒计时、按 interval 轮询、done/expired 与卸载清定时器）、components/accounts-card.tsx（按 kind 分支、正版会话刷新/退出、需重新登录、entitled=false 购买劝导、皮肤预览/披风）、components/app-sidebar.tsx（当前账号皮肤头像）、pages/settings-page.tsx 与 pages/home-page.tsx 文案中性化。最后一版优先级修正：皮肤详情接口优先于 /api/state 快照，fallback=true 时无条件使用内置 Steve/Alex，保证 slim 模型一致。
- 构建：pnpm build exit 0（vite v8.3.7，2217 modules，最终 dist/assets/index-az2NZ5u8.js 532.48 kB、index-B3TylStv.css 87.51 kB）；pnpm lint exit 0（4 条既有脚手架 warning）；cargo build 把最终 dist 重嵌进 /home/lilyco/.cache/lilyco-build/target/debug/lycomc，strings 可见 assets/index-az2NZ5u8.js。
- 实机浏览器（CDP，Chromium 156）：首页 / 设置页无 skeleton，canvas 皮肤头像 40x40 全部 1600 像素已绘制；资源请求确有 GET /api/accounts/Steve/skin 与 /api/skin/image?url=textures.minecraft.net/…；点击「微软正版登录」弹出真实 userCode（如 PCFSZLHK / 28SLGSVW）、14:59 倒计时、验证页链接，Escape 后 dialog 数归 0。设备码 start/poll 真实微软端点 200 / pending；/api/health embedded 正常。
- 提交：2a054fe（后端 6 路由 + 皮肤 + 0600 凭据）、4e48efc（shadcn 登录/皮肤 UI 与账号管理）、收尾末版微调补提；工作区最终干净。合规：只对照 PCL/HMCL/Prism/SJMCL 的公开协议与行为，不复制 PCL 的 NOASSERTION 代码/UI/资源，沿用自有 lycomc/LilyCraft 名称。
## PCL.Proto UI 复用预研与合规决策（2026-11-12 晚，m04060）

### 需求 Requirement / 理解门槛
- 用户原话：`https://github.com/PCL-Community/PCL.Proto/ 这个ui 可以抄袭`。
- 模糊词：**抄袭**（照搬代码+资源，还是只参考视觉自研）、**这个ui**（整体 PCL 风格还是某几页）。
- 门槛(a) 已满足：`cn.bing.com` 搜「PCL.Proto 许可 二次创作 UI 复用 PCL-Community」返回 200 / 101252 B。
- 门槛(b) 已问未答：`ask_user_question` 给出 3 个口径（仅参考视觉自研 / 一比一复刻并接受条款 / 先做静态 UI Demo），12 s 超时无答复（与上一轮同）。

### 调研 Research（真实 gh，2026-11-12）
- `PCL-Community/PCL.Proto`：10★ / 2 forks / public / main / pushedAt 2026-11-11T07:52:43Z / licenseInfo.key=**other**（即 NOASSERTION 类，非 OSI 许可）/ 描述 *Modeled after PCL2 and PCL2-CE, with a goal of providing a standardized prototype sample for each PCL branch version*。
- 栈：**Vue 3 + Tauri 2 + TypeScript + Bun 1.4.4 + Vite 8 + Pinia + vue-router + pug/sass**；tree 760 paths（src/views 61 / src/components 56 / src/assets 182 / crates/pcl-core 98 / public/pcl 82 / src-tauri/src 65）。版本 0.11.2。
- 组件包 `@amagicpear/pcl-proto-components` 0.11.2 导出 PButton / PCard / PListItem / PVirtualList 等 18 个 Vue 组件；其 README 明写组件包受仓库 LICENSE 约束、分发前须审阅使用条款；package.json 的 license 字段为 SEE LICENSE IN LICENSE。
- LICENSE 全文缓存 `/home/lilyco/.cache/pcl-proto-LICENSE.txt`（2987 B），关键约束逐字复述：
  - 一、声明：法律上开发者仍保留所有权利（All Rights Reserved），本文件只是善意合理使用的不追责指南。
  - 二、轻度使用：仅参考极小部分内容，**或**制作的软件与 PCL 实质功能不存在任何重叠 → 只需①适当署名 ②不得与 PCL 混淆。
  - 三、重度使用：基于本存储库修改，或参考较大量内容以制作/重新实现 PCL 的部分实质功能（例如启动或下载 Java 版 Minecraft，下载或管理 Mod 等）→ 5 条硬约束：①明确第三方二次创作 ②**名称必须以 Plain Craft Launcher (PCL) 开头**并加后缀 ③关于页首位给出龙腾猫跃署名及赞助链接、公开源代码、继续用本指南 ④实现与 McLaunchPrecheck 一致的正版购买弹窗与赞助弹窗 ⑤Windows 主色相必须为蓝色且不得有类似赞助解锁的功能/表现。
  - lycomc/LilyCraft 已实现「启动 MC + 下载版本 + 管理 Mod」，正是 LICENSE 举例的**重度使用**情形。
- 旁证（对 m03957 全平台/服务器目标有用）：仓库已含 `crates/pcl-core/src/link`（mcping / discovery / scaffolding）、`crates/terracotta`、`src-tauri/tauri.{windows,macos,linux}.conf.json`、`PageSetupGameLink.vue` / `ServerCard.vue` / `MinecraftServerCard.vue`、`MS_CLIENT_ID` 正版登录配置、`io/download/range.rs` 断点续传；但**无任何 android / harmony / ohos target 或 .apk / .hap**，Tauri 仅 Win/mac/Linux 桌面。

### 分析·设计 / fit 矩阵

| 候选 | 与 LilyCraft 目标 fit | 投入本 | 许可/品牌风险 |
|---|---|---|---|
| A 参考视觉自研：保留 React 19 + shadcn + Vite，只借鉴布局/配色/信息架构/交互层级 | 中高 | 低（不回退已交付六页 UI 与 Rust 内核） | 低：不复制 .vue/.svg/.png/文案，不构成「基于本仓库修改」；稳妥做法另加署名 |
| B fork / 安装组件包 / 整体换 Vue3+Tauri 一比一复刻 | 高（视觉还原） | 高（推翻已交付 shadcn 前端、四前端重接、引入 Bun 工具链） | **高**：触发重度使用 5 条硬约束，其中「名称必须以 PCL 开头」与 *LilyCraft / 比 PCL 更好* 品牌直接冲突 |
| C 先出 1 页静态 PCL 风原型（不接后端） | 低（仅验视觉） | 最低 | 低；用于解除「这个ui」模糊指代 |

### ROI 权衡
- 产出值：B 视觉还原度最高，但把项目锁进 PCL 品牌 + 5 条硬约束并打破「已交付不回退」基线；A 用约 20% 投入拿到约 80% 视觉收益且保住 LilyCraft 品牌；C 用最小成本验明用户到底指哪套视觉。
- 门槛：**A / C 过；B 不过**。硬理由：用户对第三方版权内容没有授权资格，一句「可以抄袭」不替代版权方许可；且 license=other 是 lyco 认定的合法硬约束。

### 决策 Decision（本节即记录；**未写任何代码**）
- 默认 **adopt A + 先 C**：以 PCL.Proto 为视觉参考样本，代码与资源全部自研，保留现有 React + shadcn 六页与 Rust 四前端内核；需要时先出 1 页静态原型供用户验收，再决定是否加页面/换组件粒度。
- 明确不做：不把其 `src/` 克隆进 `web/`、不复制 `public/pcl` 图片与 SVG、不安装 `@amagicpear/pcl-proto-components`、不改名以 PCL 开头、不引入 Tauri/Bun 替换现有栈。
- 若用户坚持 B：须先书面确认接受 5 条硬约束（改名、关于页署名赞助、公开源码、正版购买弹窗、Windows 蓝色主色相），并接受前端重写与「不回退」基线被打破，再单独立项。
- 验收标准：对照 `screenshot.png` 的信息架构 / 卡片 / 导航层级；`pnpm build` + `pnpm lint` 通过；CDP 六页 0 skeleton；git 仅新增自研代码与 docs；本节可复核。

### 验证 Verify / 源
- `gh repo view PCL-Community/PCL.Proto`、`gh api repos/.../license`、`README-CN.md`、`packages/components/README.md` 与 `package.json`、`git/trees/main?recursive=1`（760 paths → `/home/lilyco/.cache/pcl-proto-paths.txt`）、`screenshot.png`（2572499 B → `/home/lilyco/.cache/pcl-proto-screenshot.png`）。
- 证据缓存：`/home/lilyco/.cache/pcl-proto-{LICENSE.txt,README-CN.md,AGENTS.md,paths.txt,screenshot.png}`。

## 全 UI 迁移验收收尾（2026-11-13）

- 用户目标 /gaol「做好视觉 所有ui 迁移 https://github.com/PCL-Community/PCL.Proto/」已按前述 adopt A（参考视觉自研）执行；适用范围为现有 6 个 Web 路由与全局组件，不引入 PCL.Proto 代码、资源、组件包、Tauri/Bun，也不改名以 PCL 开头。
- 实现清单、构建/测试、CDP 六页 0 skeleton、主题与微软登录对话框交互冒烟、证据哈希、合规扫描及目标边界详见 docs/UI-MIGRATION.md。
- 验收结论：视觉迁移完成；全平台 Windows / Android / 鸿蒙、服务器游玩、四平台实机演示仍属另一目标，未因本次提交而达成。

## 四项 UI 缺陷修复决策（2026-11-13，m04319 / m04328 / m04324）

- 需求与理解门槛：用户报 ①切换用户名时账号显示没有更改 ②左下角当前账号不能快速切换账号和默认账号 ③启动器/社区资源图标缺失 ④动效没做。已按 lyco 护栏做一次同步 Web 搜索（cn.bing http=200）并 ask_user_question 直接确认；用户答复逐字：「对标PCL 的效果和UI 动效是 PCL的动效 其他 三点你说的没错，也完成」。
- 调研：PCL-Community/PCL.Proto license=other / All Rights Reserved，本项目属重度使用场景，沿用已提交的 adopt A 合规决策。动效行为规格来自 /home/lilyco/.cache/pcl-proto-motion/ 的 usePageTransition.ts、cardDropAnimate.ts、tests/ui/page-transitions.test.mjs：退出 70ms / translateY(-6px) / opacity→0 / linear / 15ms stagger / 主·子页 110·130ms / aside 横向或缩放；入场 y[-20,0] opacity[0,1] / delay min(i*60,240ms) / 600ms 弹入；先批量读 computedStyle 再写、快速连点共享一次退出、prefers-reduced-motion 跳过、异常恢复 pointerEvents 并 cancel animations。只取数值与时序，不取源码。
- 根因：AppDataProvider 的 currentAccount 写死 accounts[0]；home-page 用局部 pickedAccount 只改启动名，头像/名称/类型仍取 currentAccount；后端 Settings 与 SettingsPatch 没有默认账号字段，API/CLI launch 缺省恒取 accounts[0]；侧栏「启动器/社区资源」用 4 个纯边框 span 占位；App/router 无页面过渡层、index.css 无 @keyframes。
- fit / ROI：A = 全局当前账号状态 + settings.defaultAccount 持久化 + 左下角 DropdownMenu 快速切换与设默认 + lucide 真实图标 + 自研 WAAPI/CSS 动效（中等投入，一次覆盖 4 项，不改 14 命令注册表、不加依赖）；B = 只修前端显示（低投入，但默认账号仍失效）；C = 引入 motion 库或复制 PCL.Proto 的 Vue/TS/CSS（触发 license=other 硬约束并加新依赖，否决）。
- 决策 adopt A：React 与 Rust 代码全部自研，不复制 PCL.Proto 的 .ts/.vue/.css/.svg/.png，不装 @amagicpear/pcl-proto-components 或任何动画库，不引 Tauri/Bun，不改名以 PCL 开头。Settings 增加 Option<String> 的 defaultAccount（serde default 向后兼容），API 与 CLI launch 缺省取它并回退 accounts[0] / Steve；CLI settings-set 增可选 --default-account（14 命令数不变）；GET /api/settings、/api/state、settings-show 自然带出新字段。前端把「当前账号」提升为会话级全局状态（快速切换不落盘），默认账号由后端 settings.json 持久化：设默认走 POST /api/accounts/:name/default，清除走 PUT /api/settings 的显式 null；AccountsCard 按 defaultAccount 显示默认徽标，左下角与顶栏共用 AccountMenu。动效用 Web Animations API + 自研 @keyframes 实现退场/入场/卡片悬停/按压，遵守 reduced-motion。
- 验收：cargo test（含默认账号与 SettingsPatch 单测）、cargo build、pnpm build、pnpm lint、CDP 六页 0 skeleton、CDP 交互实测「切换账号后顶栏+侧栏+主页+账号卡同步」「设为默认后 settings.json 持久化且刷新保持」「清除默认后 API/磁盘/state 同步清空并回退第一项」「四处真实图标」「页面切换退/入场动画与 reduced-motion 跳过」；证据补入 docs/UI-MIGRATION.md 后提交；git 仅含自研代码与 docs。
- 交互验收发现的 P0（2026-11-13）：/home/lilyco/.cache/lycomc-cdp/four-fixes.mjs 实测「清除默认（回退第一项）」点击后 API、磁盘、/api/state 仍保留旧 defaultAccount。可逆 HTTP 探针复现 PUT {defaultAccount:null} 返回 200 但不清空，javaPath / selectVersion 同样受影响。根因是 SettingsPatch 的裸 Option<Option<String>> 让 serde 把 present null 与 missing 都解成外层 None，apply 的 if let Some(v) 不触发。修复为三个可空字段加 #[serde(default, deserialize_with = "double_option")]，使 present null → Some(None)、missing → None；补 4 个 SettingsPatch 单测并用 CDP + HTTP 复验。此修复同时兑现 CONTRACT.md 早期声明的「显式传 null 才清空」。
- P0 复验结论（2026-11-13 20:48）：cargo test 25 passed / 0 failed；9 次可逆 PUT 探针覆盖字段缺失、三字段同时清空、单字段清空与显式值写入，API / settings.json / /api/state 三处一致且最终恢复用户设置；重启加载新二进制后 four-fixes.mjs 13/13 checks=true、error=null、original_default_restored=true，5 张截图哈希见 docs/UI-MIGRATION.md §7.4。

## 小白开箱即用 · 原生桌面壳与四端源码决策（2026-11-13 晚，m04829 / m04836）

### 需求 Requirement / 理解门槛
- 用户原话 A：「做好小白使用教程 做好简单的入门 ui 界面 快捷方式 托盘图标 桌面客户端等 / 做好测试 / 小白不懂端口和 ip 打开」。
- 用户原话 B：「不只是linux 系统 还有所有平台 android windows linux macos」。
- 模糊词：所有平台（桌面原生包、安卓安装包还是同一套源码）、小白打开（双击图标、自动发现服务、不可见端口和 IP）、桌面客户端（原生窗口还是浏览器）、Android（手机上真玩 Java 版还是遥控器 / PWA）。
- 门槛(a) 已满足：cn.bing 搜索 tauri 2 mobile android ios desktop one codebase official、tauri tray icon single instance plugin official docs、Electron vs Tauri tray app 托盘 快捷方式 打包 windows macos linux 均 HTTP 200；LilyCraft 全平台搜索亦 200。
- 门槛(b) 已问未答：ask_user_question 三问（Android 形态：遥控器 / Pojav 真玩 / 网页 PWA；Win/mac 验收：源码+CI 还是必须给签名安装包；快捷方式：首次运行自动创建还是安装包自带）带 20s 选项等待，外层 run_code 在 60000ms 到期，用户未选择。必须显式标注工作假设并在交付答复再次询问。
- 当前长期目标 goal-ff34eb90-830f-427d-bbc4-1882a96c5339 为 active / armed，objective 已含「源码覆盖 Windows/macOS/Linux/Android」。

### 调研 Research（真实本机 / gh / crates，2026-11-13）
- 现成方案：gh search repos 四轮（minecraft launcher tauri / minecraft launcher tray / minecraft launcher desktop tauri android / pcl launcher tauri）只得到 8 个 0–1 星低活跃 Tauri MC 启动器，无覆盖四端、托盘、快捷方式、教程、既有 lycomc 内核的主流现成项目；tauri 官方 GitHub API 403 限流，但 static.crates.io 的 wry crate 可访问。PCL-Community/PCL.Proto 仅 Win/mac/Linux Tauri 桌面，无 Android / 鸿蒙工程，且其 LICENSE 为 other / All Rights Reserved，沿用既有合规决策：不复制其代码与资源。
- 本机 GUI：pkg-config 具备 gtk+-3.0 / libsoup-3.0 / webkit2gtk-4.1 / webkit2gtk-web-extension-4.1 / ayatana-appindicator3-0.1；动态库 libwebkit2gtk-4.1.so.0 与 libayatana-appindicator3.so.1 存在。/home/lilyco/.cache/lycomc-desktop-poc 用 wry 0.57.2 + tao 0.37.2 + tray-icon 0.25.1 编译并真实创建窗口、WebView、托盘成功，但 Wayland 默认句柄触发 UnsupportedWindowHandle；强制 GDK_BACKEND=x11 并继承 XAUTHORITY 后日志逐字为 poc: window+webview+tray created。此为「Linux 原生壳可行」的硬证据，不能把编译成功当运行成功。
- 交叉工具链：rustup 已装 aarch64-apple-ios / aarch64-linux-android / aarch64-unknown-linux-ohos / x86_64-pc-windows-msvc / x86_64-unknown-linux-gnu；本机无 x86_64-w64-mingw32-gcc、osxcross、xcrun、Android NDK、cargo-ndk、cargo-tauri。Windows/macOS/Android 只能交付源码 + GitHub Actions / Gradle / cargo-packager 配置，不能匿名产出已签名 exe / dmg / apk。Android 若要本地真跑 Java 版 MC，还需 Pojav 类运行时 + NDK + 签名，且用户未确认，本轮不承诺。
- lycomc 既有约束：14 条 lilyco 命令、include_dir! 嵌入 web/dist、axum 25 路由、25 个单测、六页 shadcn UI、微软设备码登录与皮肤均不可回退。裸跑当前打印 http://127.0.0.1:8766 并 xdg-open，正是小白不懂端口和 IP 的产品缺口。

### 分析 · 设计 / fit 矩阵
- A 薄壳自研：新增 Rust lib + desktop 模块，桌面端同进程启动 axum 隐藏端口，wry/tao 原生窗口直接加载 Web UI，tray-icon 托盘菜单「打开主界面 / 使用教程 / 退出」；Linux 首次运行写 .desktop 与桌面快捷方式；Android 提供 JNI + WebView + 本地 axum 的源码骨架，PWA 给浏览器兜底；Win/mac 打包用 cargo-packager + GitHub Actions。投入中等，保留全部既有内核与 UI，合规风险低。
- B 引入 Tauri 2 CLI / 迁移 PCL.Proto 工程：视觉与移动脚手架较全，但需 Bun + Vue + Tauri 独立骨架，推翻 React/shadcn 六页与四前端，触发 license=other 重度使用约束，本机无 cargo-tauri。否决。
- C 只改 README / 写死 xdg-open：投入最低，但用户仍要懂端口与 IP，桌面客户端 / 托盘 / 快捷方式 / 四端源码都未兑现。否决。

### ROI / 门槛
- A 用约三成改造拿到约八成「小白双击即用」收益：端口和 IP 从界面与启动流程消失，Linux 可实机验证，Win/mac/Android 有可复现源码与 CI；B 收益被品牌许可与重写成本抵消；C 不满足验收。
- 硬门槛：Linux 桌面必须真实启动窗口 + 托盘 + 快捷方式 + CDP/截图；不得破坏 cargo test 25 项、CLI 14 命令、Web 25 路由、六页 UI；不得把 Win/mac/Android 源码配置谎称为已签名安装包或四端实机演示。

### 决策 Decision（本节即记录；决策先于应用代码）
- adopt A。先把 src/main.rs 的模块声明收敛到 src/lib.rs（rlib + cdylib），保留原 bin 入口；新增 api::start_embedded() 在后台 tokio 线程绑定 127.0.0.1 随机可用端口并返回端口，不打印 URL、不 xdg-open、不暴露给用户；桌面模块在 Linux Wayland 会话下自动设置 GDK_BACKEND=x11 并尝试从 XDG_RUNTIME_DIR 补 XAUTHORITY；窗口关闭最小化到托盘。
- 入口：桌面双击 / 裸跑优先原生窗口；显式 --web / --gui 保留浏览器控制台；CLI / --tui / --mcp 原样保留。Windows 用 windows_subsystem=windows 隐藏控制台。前端零术语、三步首启向导、#/guide 五节图文教程、PWA manifest 与 service worker 由 ui 同伴在 web/ 目录自研完成，本模块不写 web/ 源码。
- 快捷方式：Linux 首次运行以自研 SVG 图标生成 ~/.local/share/applications/lilycraft.desktop、~/.local/share/icons/hicolor/scalable/apps/lilycraft.svg 与桌面目录的 LilyCraft.desktop；只在缺失或含 LilyCraft 标记时覆盖，避免破坏用户手工修改。Win/mac 快捷方式由 cargo-packager 安装包负责。
- 四端源码覆盖：Windows/Linux/macOS 共用 desktop.rs；Android 用 android/ Gradle + Kotlin WebView + JNI 调用 liblycomc.so 的 nativeStart 启动本地 axum，加载 http://127.0.0.1:{port}/#/，Gradle 任务与 CI 复制 .so；浏览器 PWA 复用同一 Web UI。Android 工作假设 = 本地管理 / 教程 / 远程控制壳，不是在手机上直接运行 Java 版 MC；若用户选择 Pojav 真玩需另立 NDK 与运行时项目。
- 打包：packaging/Packager.toml（显式 `-c` 传入，不写死 formats，由 cargo-packager 取平台默认格式）产出 Linux deb / AppImage、Windows NSIS 安装器、macOS app / DMG；图标在 packaging/icons/（自研 SVG + 多尺寸 PNG + 多尺寸 ICO）。.github/workflows/release.yml 矩阵执行 pnpm build → cargo test/build → cargo packager → Android Gradle assembleDebug；只上传 artifact，不自动创建 GitHub Release、不推送、不打 tag（须用户显式授权）。
- 验收：cargo test / cargo build / pnpm build / pnpm lint；CLI --schema 仍 14 命令；HTTP 25 路由回归；CDP 六页 + #/guide + 首启向导；systemd-run 真实启动桌面壳并截图；.desktop 内容与快捷方式落盘；端口字符串不出现在 UI 与桌面启动日志；Workflow YAML 与 Gradle/Kotlin/Manifest 本地解析或语法检查；最终文档明确 Linux 实机已验、Win/mac/Android 是源码+CI、未产出已签名安装包。

### 边界与未决问题
- 用户尚未回答 Android 形态、Win/mac 是否必须给安装包、快捷方式生成方式三问；本轮按上述工作假设推进，并在最终答复再问一次。
- 不等同于 m03957 的「比 PCL 更好 / 全平台实机演示 / 服务器游玩」已达成；Windows、macOS、Android 未做实机截图，也未产出签名安装包。
- 不引入 Tauri CLI、不复制 PCL.Proto 源码/资源、不改名以 PCL 开头、不改变 LilyCraft 品牌。

## Web 优先 · 桌面壳降为 feature · NSH 观察项（2026-11-14 下午，m06445 / m06446 / m06447）

> 本节取代上一节「桌面双击 / 裸跑优先原生窗口」的入口优先级；上一节作为 2026-11-13 的历史决策保留，不改写。

### 需求 Requirement / 理解门槛
- 用户原话（m06445）：「算了 吧 坚持 web 优先 客户端 只作为 features 而且还难维护」。
- 用户原话（m06446 / m06447，两次）：「https://github.com/longbridge/nsh 这个有帮助么」。
- 模糊词：web 优先（默认入口、构建依赖、交付口径）、客户端只作为 features（Cargo feature 还是插件包）、有帮助（现在引入 / 借鉴思路 / 仅观察）。
- 门槛：不能回退已交付的 14 命令、25 路由、SSE、微软设备码、皮肤、六页 shadcn UI；不能把桌面壳历史 P0 伪称已完整 GUI 复验；不能把 Windows/macOS/Android 源码 + CI 说成已签名安装包或实机演示。

### 调研 Research（真实仓库 / 本机，2026-11-14）
- longbridge/nsh：GitHub API 描述 "Native Shell is a native UI framework for iOS, Android, macOS, Windows, Linux and the web, built in Rust."，homepage https://nsh.dev，language Rust，2722★ / 183 forks，topics [cross-platform, gui, native, nsh]，created_at 2026-10-14T14:59:36Z，pushed_at 2026-11-14T06:50:05Z，open_issues_count 93，GitHub API license NOASSERTION；根 LICENSE-APACHE 是完整 Apache-2.0（HTTP 200 / 10297 B），属 API 元数据未识别，商用前仍应做法务确认。
- 8 个 release：v0.1.0 2026-10-17 → v0.5.1 2026-11-14T05:22:06Z，另 nightly；项目仅一个月、节奏极快。README 支持 Rust / TSX 混合、运行时加载签名 TSX 模块（plugins / features / AI 生成 UI）、`nsh run --target web` / `nsh package --target web` 静态站点、iOS/Android/macOS/Windows/Linux/Web/Terminal 多后端，并致谢 shadcn/ui design tokens。HN Algolia 命中 3 帖，评论数 0–2；StackOverflow 未见 NSH 生产案例 → 社区验证很薄。
- 本机 / 现有架构：wry 0.57 / tao 0.37 本就由 Tauri 社区维护，已复用 WebKit2GTK / WebView2 / WKWebView 适配；不迁移 Tauri CLI 也可跨平台。`cargo check --target x86_64-pc-windows-msvc --lib` 实测报 `failed to find tool "lib.exe"`，本机无 mingw / osxcross / xcrun / Android NDK / cargo-ndk / cargo-tauri；鸿蒙无 Rust wry backend。Windows / mac / Android / 鸿蒙是工具链与实机缺口，不是 Web 架构不支持。
- 桌面壳现状：`src/desktop.rs` 的 `build_as_child` 已修本机 Xwayland 黑屏；焦点桥 IPC 有单测但 `p0bs.png` / `p0input.png` 停在 step=0，不能证明「离开输入框 → 回来 → 再输入」干净复验。用户已把该 P0 降级，不再投入 GUI 深挖。

### 分析 · fit / ROI 矩阵
- A（adopt）Web 优先 + 桌面壳 Cargo feature：默认 `cargo build` 不编译 wry / tao / tray-icon / muda，不链接系统 WebView；无参数 / `--web` 都 `api::serve()` 并自动开浏览器；`--desktop` / `LILYCO_UI=desktop` 才进可选窗口，未启用 feature 时提示后回落 Web；`scripts/check.sh` 与 CI 双轨守卫；快捷方式 `Exec` 带 `--desktop`。投入低，直接兑现「难维护」诉求，零回退。
- B 全量迁 longbridge/nsh：需要把 React 19 + shadcn + Tailwind 4 + axum 的六页与 14 命令注册表绑到新 Rust UI 运行时、nsh CLI、签名包 / sandbox；新增一个一个月大、93 open issues、社区验证薄、license 元数据未识别的维护面。与 m06445 相反，否决。
- C 继续桌面优先、只把 NSH 当托盘皮肤：仍默认链接 GTK / WebView，裸跑抢主入口，维护负担不变；否决。
- D 直接删掉 `src/desktop.rs`：会丢掉已实机验过的窗口 / 托盘 / 快捷方式与未来可选 feature，且用户说的是「只作为 features」不是「删除」；否决。

### 决策 Decision（本节即记录）
- 入口：`src/main.rs` 反转优先级；`src/lib.rs` 用 `#[cfg(all(feature = "desktop", any(target_os = "linux", target_os = "windows", target_os = "macos")))]` 门控 `pub mod desktop;`；`Cargo.toml` 新增 `[features] default = [] / desktop = ["dep:wry", "dep:tao", "dep:tray-icon", "dep:muda"]`，target 依赖全部 `optional = true`，`examples/wry_min.rs` 加 `required-features = ["desktop"]`。
- 分发：`packaging/Packager.toml` 的 `beforePackagingCommand` 显式 `cargo build --release --features desktop`；`.github/workflows/release.yml` 与 `scripts/check.sh` 都跑默认 Web + 可选 desktop 两轮守卫。默认安装包双击仍走 Web；只有带 `--desktop` 的快捷方式进原生窗口。
- 快捷方式：`install_linux_shortcuts` 生成的 `.desktop` 的 `Exec` 从 `"<exe>"` 改为 `"<exe>" --desktop`，并让单测直接调用生成函数，避免 Web 默认下双击快捷方式误进浏览器。
- NSH：列为「未来原生壳 / features 观察项」，借鉴 shadcn tokens、`--target web` 静态产物、签名 TSX features 思路；**不复制代码、不引入 nsh CLI / 运行时、不重写 `web/` 与 `src/desktop.rs`、不改名以 PCL 开头**。
- 证据口径：Web 优先主证据 = 默认无参数二进制的 `/api/health` + 浏览器 CDP 六路由 / `#/guide` / 图表 / 首启向导截图；桌面截图只作历史，不再当主线验收。

### 边界与未决问题
- Windows / wine：Web 优先下不再把 `.exe` / 签名安装包当交付门槛；Windows / mac 用户只需浏览器 + 本机服务，wine 可跑 Web UI 或 exe 但非主线。
- m03957「全平台实机演示 / 服务器游玩」需按 Web / PWA 浏览器优先重新界定，待用户确认；不宣称已达成。
- m04829 / m04836 三问（Android 形态、Win/mac 是否必须安装包、快捷方式生成方式）仍未答；Web 优先下先按「浏览器 PWA + 源码 / CI」推进，不阻塞主线。
- m06349 桌面输入 P0 已由 m06445 取代 / 降级；焦点桥代码与单测保留，但不宣称完成干净 GUI 复验。
- m06729 补充：「exe 也可以，优先本机 web exe 程序」——Windows / macOS / Linux 默认入口都是同一个本机 Web 可执行程序，启动后由平台默认浏览器打开；`maybe_open_browser` 增加 Windows `rundll32` / macOS `open` / Linux `xdg-open` 分支，并让 Windows 不再依赖 DISPLAY。本机仍缺 MSVC `lib.exe`，不产出 Windows `.exe`；源码与 CI 路径保留。

## 一键直连多人服务器（quickPlay，2026-11-14 晚，m06887 / m03957 子项）

> 本节只推进 m03957 的「服务器游玩」最小闭环；全平台实机演示、Android / 鸿蒙、Win/mac 安装包仍按上一节边界，不在此宣称达成。

### 需求 Requirement / 理解门槛
- m06887「继续」时，Web 优先目标（goal-ff34eb90…）已 complete；在浏览器主链路上选一个不回退、不加依赖、可实机验证的增量。
- 「服务器游玩」理解为启动后直接进入多人服务器，而不是在启动器内嵌 MC 服务器浏览器 / 好友组队 / 内网穿透；PCL 式「一键进服」先做最小闭环。
- 门槛：默认入口仍是本机 Web 可执行程序；不新增 API 端点、不引入新依赖、不动 14 命令 / 26 路由 / SSE / 正版登录 / 皮肤 / 教程 / 图表；旧 settings.json 与旧客户端必须继续可用。

### 调研 Research（本机真实元数据与字节码）
- 本机 `1.20.1.json` 与 `26.3.json` 的 arguments.game 均有 6 条 feature 规则，其中 is_quick_play_multiplayer → `["--quickPlayMultiplayer","${quickPlayMultiplayer}"]`；另有 has_quick_plays_support → --quickPlayPath、is_quick_play_singleplayer、is_quick_play_realms、is_demo_user、has_custom_resolution。
- javap 1.20.1 / 26.3 的 net.minecraft.client.main.Main 对 --quickPlayMultiplayer 均 OptionParser.accepts(...).withRequiredArg()；26.3 的 QuickPlayLog / GameConfig$QuickPlayData 说明 --quickPlayPath 仅是可选会话日志，直连不必启用它。
- fabric-loader-0.20.1-1.20.1.json 顶层无 arguments.game，靠 inheritsFrom=1.20.1 经 install::merge 继承父参数，所以父版 quickPlay 规则对 Fabric 同样生效。
- 阻断根因：meta::rule_matches 原为 `if features.values().any(|want| *want) { return false; }`，一刀切拒绝所有 features 规则；install::plan_libs 也调用 rules_allow，不能全局放开，否则会误开 --demo / --width 并破坏 libraries 规则求值。

### 分析 · fit / ROI 矩阵
- A 全局放开 features：会让 demo / 自定义分辨率 / 单人 / Realms 规则同时生效，且改变 libraries 选择；否决。
- B 在 args 末尾手工追加 --quickPlayMultiplayer <addr>：绕过元数据，旧版本不认识该选项会直接崩，且可能与元数据重复；否决。
- C 白名单 opt-in：rules_allow_with(rules, enabled) 只按调用方传入的 enabled 放行指定 feature，rules_allow 仍传 &[] 保持 libraries 旧行为；launch::expand(list, enabled) 只给启动参数传 ["is_quick_play_multiplayer"]，并把 quickPlayMultiplayer 加入变量表。零新端点、零新依赖、旧版自动退化为进主菜单；采纳。

### 决策 Decision（本节即记录）
- 内核：mc/meta.rs 增 rules_allow_with 与 rule_matches(r, enabled)，rules_allow 保留旧签名 / 旧行为；mc/launch.rs 增 QuickPlay::Multiplayer、clean_server_address（host[:port] 白名单：trim、<=255、拒绝前导 - / -- / 空白 / 控制 / 引号 / 反斜杠）、resolve_quick_play(override, default)、LaunchOpts.quick_play；prepare 只在元数据规则存在时注入参数并写「直连服务器: …」日志，否则写「当前版本元数据不支持 quickPlay，已正常进主菜单」。
- 配置 / API：Settings.quickPlayServer?:string|null 默认 null、sanitize 经白名单；PUT /api/settings 用 double_option 区分缺失 / 显式 null；POST /api/launch 增 server?:string|null，语义为「本次覆盖」：字段缺失才回落默认值，显式 null / 空串 / 非法值清空本次直连但不改写默认值；lycomc launch 增 --server <地址>（命令数仍 14）。
- 前端：主页启动区「直连服务器」与设置页「默认直连服务器」两个 shadcn Input；主页本次值作为 api.launch 第 4 参，且与默认值不同时异步 saveSettings 写回默认，不阻塞启动；零术语说明「留空就正常进主菜单」。
- 验收：真实 1.20.1 / Fabric CLI --dry-run 矩阵、临时 LYCOMC_DATA_DIR + fake-Java 的 HTTP 探针（不真启动 MC）、独立 Chromium CDP 真实输入与保存 / reload 回落；详见 TEST-REPORT.md §10 与 TEST-EVIDENCE.json 第 9 组。

### 边界与未决问题
- 只覆盖带 is_quick_play_multiplayer 规则的 MC 1.20+ 版本；旧版本不会追加未知选项。
- 本次验收用 fake-Java 记录 argv 与 job 命令，未连接真实多人服务器、未产出进服后的游戏截图；不宣称「已实机联机成功」。
- 地址白名单是防选项注入的最小防护，不替代 SRV / IPv6 / 中文域名的完整解析支持。
- 全平台实机演示 / 签名安装包、m04829 / m04836 三问仍未答；桌面壳输入 P0 仍按 m06445 降级冻结；Windows .exe 本机仍缺 MSVC lib.exe。

## 真实本机联机补证（2026-11-14 深夜，m06887 / m03957 子项）

> 本节只追加 e45976b 之后的实机证据，不改写上一节 quickPlay 决策与边界，也不改写 TEST-REPORT §8 / §9 / §10 的历史矩阵。上一节「未连接真实多人服务器、未产出进服后的游戏截图」是 §10 fake-Java 验收当时的事实陈述；现由本节与 TEST-REPORT §11 补充。

- 决策：不新增功能、端点或依赖，直接用已提交的默认 Web 二进制，在隔离 LYCOMC_DATA_DIR 中启动官方 1.20.1 服务端与真实客户端，验证 POST /api/launch 的 server 字段能把 --quickPlayMultiplayer 127.0.0.1:25565 变成真实进服。
- 证据：服务端日志 Steve joined the game；客户端日志 Connecting to 127.0.0.1, 25565；KWin 激活后用 spectacle --activewindow 抓取到标题含「Minecraft 1.20.1 - 多人游戏（第三方服务器）」的游戏画面；POST /api/launch/{pid}/kill 返回 200，服务端 / Web 服务 / 客户端均退出，25565 与 9490 端口释放，真实用户数据四项哈希不变。
- 安全：隔离目录只放离线账号 Steve；online-mode=false 仅用于本机离线服；证据中的启动命令凭据已替换为 <redacted>，严格凭据扫描 0 命中；没有读取或打印真实微软账号 token。
- 边界：这是本机 1.20.1 离线模式独立服务端的实机联机补证，不是公网服务器 / 正版账号联机 / 跨 Windows、macOS、Android、鸿蒙实机演示；不宣称安装包或签名包已产出。m03957 其余部分与 m04829 / m04836 三问仍待用户重新界定。

## 性能 / 稳定性优化与 GitHub Actions Release 决策（2026-11-15，m07261）

- 需求：用户要求「写出测试完成报告、做好各种功能 / 性能 / 对比测试，接下来发布 GitHub Runner Action Release 和性能优化、稳定性优化」。约束是 Web 优先不回退：默认本地 Web 可执行程序仍是主入口，桌面壳仍仅是可选 Cargo feature，14 命令、26 条后端路由、SSE、正版登录 / 皮肤、教程、图表、quickPlay 与 §11 真服联机证据均不回退。
- 调研：旧 release.yml 是手工 artifact-only 工作流，Rust 检查大量以 `|| true` 掩盖失败；`Cargo.toml` 使用本机绝对路径 `lilyco` 依赖，公共 Runner 必然无法解析。性能热点实证为 `/api/state` 在 axum async worker 上串行 `java -version`，静态资源每次请求复制近 1 MB JS，SSE 每个百分比都克隆并广播完整 Job；稳定性风险是 Java 探测无超时、管道填满或慢候选后代持有 fd 时会挂住。
- 方案矩阵：A 只改文档不做实测（否决，无法回答「测试完成 / 对比测试」）；B 全局放开缓存且不区分启动前 / 状态刷新（否决，新装 JRE 可能 30 s 内看不到，且 /api/state 仍可能阻塞）；C 本机采集 baseline 后再做限界优化 + 独立功能 / 性能 / 稳定性对比（采纳）；D 把 Rust 失败继续 `|| true` 隐藏（否决，与发布可信度冲突）；E 把 17 MB lilyco 源码 vendor 进仓库（否决，采用公开固定 Git rev 更轻且可复现）。
- 决策：Java 探测采用 2 s 超时、Unix process-group SIGKILL、pipe drain、30 s 数据目录键缓存、候选并行与 `spawn_blocking`；启动路径 `pick()` 强制 fresh scan 保证新装 Java 立即可用；静态资源零拷贝；SSE 仅节流纯百分比且保留日志与终态事件；`lilyco` 锁到公开 Git rev；CI 与 Release 改成真门禁，Release 在三种 Runner 上产出 Web 可执行程序、校验和和 GitHub Release。
- 证据口径：§12 使用最终二进制 `f4442166…` 与 baseline `be2690aca…` 的独立对比；第 11 组证据用完整 SHA-256 登记 36 个产物 / 脚本 / 源码 + manifest 自身。所有远端平台产物只认 GitHub Actions 运行与 Release 资产，不把本机 debug Linux 数据冒充 release / 跨平台实机结果。
- 边界与未决项：本机仍有 m03957 的全平台形态 / 安装包 / 公网正版联机 / 实机演示，以及 m04829 / m04836 的 Android 形态、Win/mac 是否必须签名安装包、快捷方式口径三问待用户定义；桌面输入 P0 已按 m06445 降级冻结，本轮不复活原生桌面壳工作。

## Windows Release 编译失败后的跨平台门禁决策（2026-11-15，m07261 发布收口）

> 本节为纯追加，不修改上一节性能 / 稳定性优化决策，也不改写历史失败事实。

- 触发：首次发布 run 43635688234 的 Windows job 编译失败，精确错误 error[E0425]: cannot find function kill in crate libc / error[E0425]: cannot find value SIGKILL in crate libc；原来的 src/api.rs:551 libc::kill(pid as i32, libc::SIGTERM); 与 src/api.rs:563 libc::kill(pid as i32, libc::SIGKILL); 是 POSIX-only。

- 方案矩阵：A 按 rustc 建议把 SIGKILL 换成 Windows 的 SIGILL（否决：常量存在但语义完全错误，且 kill 函数仍不存在）；B 用 Arc<Mutex<Child>> 改写全部进程生命周期（否决：src/api.rs:471-496 的 spawn_blocking reaper 持有 Child 并 wait()，kill 取锁会死锁，改动面远超修复）；C 新增 windows-sys 调 TerminateProcess（否决：仅为一次 PID 终止引入 Cargo.lock / 依赖面扩大）；D 用 #[cfg(unix)] POSIX 信号 + #[cfg(windows)] taskkill.exe + 其他平台显式错误，并补 CI / Release 三平台 cargo check --locked --all-targets --target 门禁（采纳，因为改动局部、保持 PID 语义、能阻止同类问题再次进入发布）；E 只修 Windows 代码不加门禁（否决：Linux-only CI 已证明无法提前发现该 cfg 错误）。

- 决策：src/api.rs:537-653 保留 graceful → 3 s 后 force 的既有行为；Unix 通过 signal_game 拒绝越界 PID、把 ESRCH 当幂等成功；Windows 通过 %SystemRoot%\System32\taskkill.exe /PID <pid> /T [-F] 且 CREATE_NO_WINDOW=0x0800_0000；src/mc/java.rs:451-454 仅修正测试 import cfg。.github/workflows/ci.yml:63-99 加 Windows / macOS cross-compile；.github/workflows/release.yml:24-64 加三平台 guard，build 的 needs: guard 是发布硬门槛。

- 发布策略：旧 v0.1.0 只有失败 run、没有 GitHub Release 对象（gh release view 为 release not found），因此 --force-with-lease 重指向修复提交 f6640ab306c7ca2bdb1380d98f82d46a78fd7556，避免发布一个永远不会成功的旧 tag，同时不伪造 v0.1.1 变更。若未来 tag 已产生公开 Release，则不得沿用此策略，应发布新的递增 tag。

- 实证：43640971733 3/3 CI jobs success；43641351214 7/7 Release jobs success；43641351231 tag CI success；6 个 Release 资产 3/3 校验和匹配；Linux 发布包 --schema + runtime smoke EXIT=0。本机 MSVC SDK / Darwin C toolchain 的交叉检查失败不作为远端平台结论。

- 口径：新增的成功证明不删除 43635688234 的失败记录；§13 的下载校验、归档结构、Linux 二进制启动与 §11 实机联机、§12 性能对比是不同层级证据。发布后文档补证提交在 main，tag 仍锁定 f6640ab306c7ca2bdb1380d98f82d46a78fd7556。

- 未决项不变：m03957 的 Android / 鸿蒙 / 签名包 / 公网正版联机 / 全平台实机演示，以及 m04829 / m04836 的 Android 形态、Win/mac 签名包要求、快捷方式口径；桌面输入 P0 继续按 m06445 冻结。

## 发布后加深验证与 v0.1.1 补丁决策（2026-11-15，m07969 / m08285「继续」）

> 纯追加，不修改既有性能 / 稳定性 / Windows 门禁决策，也不改写 v0.1.0 发布事实。

- 触发：v0.1.0 发布后用户「继续」驱动对发布物做加深验证，发现 CLI --help / --schema 顺序随机（lilyco-core Registry 用 HashMap，迭代顺序由随机种子决定）。
- 方案矩阵：A 在 lycomc 内维护命令顺序白名单（否决：每次上游加命令都要同步，且 MCP / TUI 仍读同一 Registry）；B 用逐字节 schema 黄金文件做 CI 校验（否决：HashMap 顺序随机会让黄金文件假失败，且无法表达顺序无关语义）；C 上游将 Registry 改为 BTreeMap 并按名有序（采纳：命令表是对外可观测契约，排序是正确行为而非巧合）；D 仅本地修顺序不修上游（否决：其他下游如 MCP / TUI 仍有同样问题，且 lycomc 依赖 lilyco 公共 rev）。
- 决策：走上游 PR #48（fix/deterministic-registry-order → mergeCommit 322fb9ceaee50c3ecf6593b73e0114159422ee90），lycomc 锁 d05626dc414e286c11f0f81b426a1026c9dffc81；同时在 scripts/check.sh 内加 6 次 --help / --schema 确定性门禁（HELP_DISTINCT / SCHEMA_DISTINCT 必须 ==1），因为 CI 每次 push 都跑该脚本，可阻止上游再次退化。
- 版本与 tag 策略：沿用 §13 既定原则——v0.1.0 已公开且产生 Release，不得 force 重指向；改用递增 tag v0.1.1（annotated），只改 lilyco rev 与自身版本，不重写 v0.1.0 历史。
- 锁策略：Cargo.lock 仅最小 diff（6 处 lilyco rev + lycomc 版本），撤销 cargo update 连带的 windows-sys 等无关重锁，避免补丁引入与顺序修复无关的依赖面变动。
- 实证与边界：canonical-schema-equality 证明三份 schema 仅顺序不同、按名排序后逐字节一致（canonicalSha256 7f196335…）；PE / Mach-O 签名边界确认三平台包未 Authenticode / 未 Developer ID 签名 / 未公证；Wine 下 Windows 包实跑覆盖 Web 服务语义但不能替代真机。
- 未决项不变：m03957 / m04829 / m04836 与桌面输入 P0 冻结状态不变。

## v0.1.1 发布完成后的文档追加与跨平台输出判据（2026-11-15，m07969 / m08285「继续」收口）

- 方案矩阵 A：为把发布后报告写进 v0.1.1 tag，force 重指向 v0.1.1 或 v0.1.0 —— 否决。已公开 Release 的 tag 只能递增，不能改写；沿用 §13 的不重写历史约束。
- 方案矩阵 B：仅为 docs 增发 v0.1.2 —— 否决。没有运行时代码变化，不应让用户把文档提交误解为另一个二进制版本。
- 方案矩阵 C：只把发布核验报告与第 15 组证据纯追加到 main，保留 v0.1.1 tag/Release 二进制与已验证提交一一对应 —— 采纳。该 docs-only 提交不在 v0.1.1 源码树内，必须在报告中明确，避免把 main HEAD 与 tag target 混为一谈。
- 方案矩阵 D：把 `--help` 原始 SHA-256 作为跨平台黄金值 —— 否决。clap Usage 行含 argv[0]，lycomc 与 lycomc.exe 必然不同；应判据为「各自连续 6 次稳定 + 除 Usage 行外逐行一致 + 命令顺序一致」。
- 方案矩阵 E：把 `--schema` 按 name 排序的 canonical SHA-256 作为语义等价、并用原始 SHA-256 作为同版本跨平台确定性证据 —— 采纳。v0.1.1 Linux/Wine Windows 两份发布包原始 schema SHA-256 相同，且按名排序后与本地修复、v0.1.0 两份 schema 一致，证明 BTreeMap 修复只改顺序不改内容。
- 证据链：group15 manifest 登记 23 个本次发布物/验证文件与第 14 组根 manifest，TEST-EVIDENCE.json 的第 15 组再登记该 manifest 自身；所有 SHA-256 完整 64 位，前 14 组字节保持不动。
- 远端结论只采信 live `gh run view` / `gh release view` / GitHub API 与下载后 `sha256sum -c`，不把本地 YAML 校验或本机 Wine 实跑等同于远端成功或真机覆盖。

## 充分测试收口：分层判据矩阵、可复用 runner 与 CI 门禁（2026-11-15，m08499 / m08502 / m08504）

- 方案矩阵 A：继续堆一次性手工脚本 —— 否决。一次性结论无法防回归，也不能作为每次改动的准入判据。
- 方案矩阵 B：把 L3–L6 固化进 `scripts/test-sufficiency.sh` 并由 `.github/workflows/ci.yml` 每次 push/PR 强制执行 —— 采纳。脚本使用动态端口、隔离数据、15 条正向/负向契约、16 并发、30s 长稳、慢 JAVA 有界探针；失败即非 0 退出，无 `|| true`。
- 方案矩阵 C：仅把发布包级结果写进 docs，不纳入 CI —— 否决。v0.1.1 发布包证据只证明该二进制，不保证后续改动不退化。
- 方案矩阵 D：把 runner 早期两轮 400/MIME 假失败记为发布包回归 —— 否决。诊断证明是 header 大小写、复用账号名、以及 `valid_name` 3–16 字符约束导致的测试脚本缺陷；保留失败诊断，修正脚本并新增非法用户名负向 case，不改写已发布 Release。
- 方案矩阵 E：为文档/测试脚本/CI 门禁增发 v0.1.2 或 force v0.1.1 tag —— 否决。发布二进制未变，docs-only + 测试门禁提交只推 main，不重发 Release，v0.1.1 peeled 仍为 5070cc1。
- 方案矩阵 F：把 `--help` 原始 SHA-256 作为跨平台黄金值 —— 保持否决（§15 决策）：clap Usage 含 argv[0]；改为同平台稳定 + 除 Usage 外逐行一致 + schema 原始字节一致 + canonical 语义一致。
- 充分性定义：先固定验收范围，再给每层写「通过条件 + 证据路径 + 不覆盖边界」；v0.1.1 的 L0–L8 已证，全平台真机/签名/公网正版联机/设备演示属于 L9 未开始。这个分层避免把 Wine、交叉编译、Runner 编译、本机 Linux 实跑混同为全平台真机验收。
- 准入规则：代码至少 L0–L5；Java 扫描补 L6；命令注册补 L7；发版补 L8；docs 改动过 L0+CI；新平台独立 L2+L8；断言必须有落盘证据；失败保留、新提交递增、不 force 已公开 tag。
- 证据：第 16 组登记 runner、矩阵、CI 配置、check/runtime-smoke/CI 等价日志、发布包输出、失败诊断与第 15 组 manifest；`docs/SUFFICIENCY-MATRIX.md` 为可复用判据基线。
- 未决项不变：m03957 全平台形态 / 公网正版联机 / 实机演示，m04829 / m04836 的 Android 形态 / Win-mac 签名包要求 / 快捷方式口径；桌面输入 P0 按 m06445 冻结。

## L9 真机与分发准入准备决策（2026-11-15）

背景：m08499「如何做好充分测试」已在 §16 / group16 收口，用户后续只说「继续」，未回答 Android 形态、Win/mac 签名包要求、快捷方式范围三问。目标是把「继续」落成可交付的 L9 准入准备，而不是伪造未具备条件的真机结论。

| 方案 | 内容 | 判定 | 理由 |
| --- | --- | --- | --- |
| A | 直接宣称 L9 已完成、补几张 Runner 截图 | 否决 | 本地无 Windows/macOS/Android/鸿蒙真机、无签名证书与 Apple 开发者凭据，Wine/交叉编译不能替代真机 |
| B | 擅自采用建议默认并立即实现 WebView 壳 / 签名流水线 | 否决 | 三项均由用户业务决定；签名需外部凭据与 secrets，未经确认即落地会返工并引入权限风险 |
| C | 什么都不做，仅回答「等你确认」 | 否决 | 「继续」要求有可交付推进，且准入判据此前只在对话里、未进仓库 |
| D | 固化 `docs/L9-READINESS.md`（三问 + 建议默认 + 判据矩阵）+ 纯追加 §17 / 新章节 / group17，明确 L9 未开始 | 采纳 | 可追溯、不改写历史、不碰 tag/Release，且把决策请求写进仓库便于后续按同一矩阵补证 |
| E | 发 v0.1.2 或 force 已公开 tag 来承载本轮 | 否决 | 本轮无发布物变更，递增 tag 无意义，force tag 破坏已公开历史 |
| F | 把建议默认写成「已确认需求」 | 否决 | 必须保留待确认状态，避免后续用未确认前提做验收 |

落地：新增 `docs/L9-READINESS.md`；纯追加 `docs/TEST-REPORT.md` §17、本决策章节、`docs/TEST-EVIDENCE.json` group17；新增 `evidence-group17-manifest.json`，以 group16 manifest 为链根。CI 门禁不变，仍由 `scripts/test-sufficiency.sh` 在每次 push/PR 守护 L0–L8。

待用户确认 A/B/C 后：按 `docs/L9-READINESS.md` 第 4 节补 L9 证据，新建 group18+ 证据组，必要时新增签名/安装器 workflow 与 secrets，不改本轮及更早结论。

## PCL-CE 100% 功能对标计划决策（Round 1）

| 方案 | 内容 | 判定 | 理由 |
| --- | --- | --- | --- |
| A | 直接宣布 100% 完成 | 否决 | 历史对比仍有 14 项未覆盖、16 项部分覆盖；PCL-CE 精确版本未确认 |
| B | 复制 PCL/PCL-CE 源码与视觉资产 | 否决 | 原版许可 NOASSERTION 且带重度使用限制；与自研 Web-first 路线冲突 |
| C | 只写计划、不实现 | 部分采纳 | 本轮采纳为「计划与差距固化」，但不算功能完成；后续每轮必须至少实现一个真实功能并补测试 |
| D | 以 41 项历史清单为代理基线，先按 P0 数据模型 → P1 启动账号 → P2 资源实例 → P3 联机帮助 → P4 UI → P5 全量测试推进 | 采纳 | 依赖顺序清晰，能把「100%」拆成可验收项；拿到 PCL-CE 版本后重算差异项 |
| E | 先做 PCL-CE 房间/EasyTier/自更新等高风险项 | 否决 | 需要服务、协议、签名与隐私决策，缺少前提下无法真实验收 |

落地：新增 `docs/PCL-CE-100-PLAN.md`，纯追加 TEST-REPORT §18、本决策章节与 TEST-EVIDENCE group18；不改 v0.1.0/v0.1.1 tag、Release 二进制、既有 CI 门禁与历史证据。
## PCL-CE 首项功能实现决策：H35 设置备份与清理（Round 2）

| 方案 | 内容 | 判定 | 理由 |
| --- | --- | --- | --- |
| A | 直接宣布 PCL-CE 100% 完成 | 否决 | 只实现 H35 一项，13 ❌ + 16 🟡 仍未覆盖 |
| B | 复制 PCL-CE 源码/资产或在 UI 仿冒品牌 | 否决 | 许可边界与自研 Web-first 路线不允许 |
| C | 只写计划继续等待 | 否决 | Round 1 决策要求后续每轮至少实现一个真实功能并补测试 |
| D | 选 H35：自包含数据模型 + 6 API + Web 页面 + 逐层验证 | 采纳 | 无外部凭据/服务依赖，能完整走通 L1/L3/L4/L5/L6，且为后续实例/设置类功能打基础 |
| E | 先做房间/EasyTier/公网正版多人联机 | 否决 | 服务端协议、账号凭据与隐私决策未定，不能在本轮证明 |

落地：新增 `src/backup.rs`、`web/src/pages/backup-page.tsx`，改 `src/api.rs`、`src/lib.rs`、`docs/CONTRACT.md`、`scripts/test-sufficiency.sh` 与前端路由/导航；CLI `--schema` 内容保持 14 命令确定性不变。证据写入第 19 组；不移动 v0.1.0/v0.1.1 tag 与 Release。

## PCL-CE E22/E24 实例资料与实例级设置决策（Round 3）

背景：H35 已在 Round 2 完成设置导入导出/备份恢复/缓存清理；本轮继续选择自包含、无需外部凭据/服务且能完整走 L1/L3/L4/L5 的 E22+E24，作为 P0 数据模型与 P4 Web 入口的下一批真实功能。

| 方案 | 内容 | 判定 | 理由 |
| --- | --- | --- | --- |
| A | 直接宣布 PCL-CE 100% 完成 | 否决 | 本轮只实现 E22 与 E24 启动设置子集，其余差距未逐项实现与验收 |
| B | 复制 PCL-CE 源码、界面或品牌资产 | 否决 | 许可边界与自研 Web-first 路线不允许 |
| C | 只补 Rust/API，不补可见 Web 交互 | 否决 | 100% 验收口径要求每个功能有可见 Web 入口与真实浏览器证据 |
| D | 新增 instances.rs + 4 端点 + /versions 页面交互 + 单测/充分性/CDP | 采纳 | 能证明元数据、隔离目录、实例覆盖、恢复全局的完整闭环 |
| E | isolated=false 时自动迁移旧 mods/options 文件 | 否决 | 默认 isolated=true 零迁移；切换只改变后续游戏目录，避免意外搬动用户数据 |
| F | PUT 实例设置整表替换，或把 null 写进非可空字段 | 否决 | 契约要求 Partial 语义；null 只删除对应覆盖并跟随全局，修复后新增单测 |
| G | 删除失败运行或用 || true 掩盖 | 否决 | 24/30 与 29/30 两份失败证据保留，按根因修复并以新提交递增 |
| H | force 已公开 tag 或重发 Release | 否决 | 本轮无发布物变更，v0.1.0/v0.1.1 保持原对象 |

落地：docs/CONTRACT.md 直接更新为活契约；scripts/test-sufficiency.sh 扩到 30 条断言并由 CI 强制；纯追加 TEST-REPORT §20、本决策章节与 TEST-EVIDENCE group20；evidence-group20-manifest.json sha256=0475518435a27079b14fee6d7e4d7d479ad8cfa90ed4ff8dc857de0a56791925 作为末项登记自身。

结论：E22 与 E24 的 7 字段启动设置子集已完成本轮验收；整体 PCL-CE 100% 仍 ACTIVE，剩余差距必须按 v2.15.1 重算并逐项补实现、测试与证据，L9 真机/签名/公网联机仍未开始。
