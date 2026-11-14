# lycomc 充分测试报告（TEST-REPORT）

> 生成时间：2026-11-12 22:15 +08:00。本文是 `docs/PCL-COMPARISON.md` 第 4 节 O-4 引用的证据矩阵，
> 逐项记录「做好充分测试 / 对标原 PCL 全部功能 / 逐项对比 / 逐步 OODA 完成」这轮目标的真实执行证据。
> 机器可检索的证据索引（含 sha256 校验和）见 `docs/TEST-EVIDENCE.json`；截图/输出原件路径全部列于其中。
> 原则：只写工作区与工具结果能复核的事实，不写推测；每项给出可复跑命令或证据文件。

## 1. 七层测试证据矩阵

| 层 | 范围 | 规模 | 结果 | 主要证据 |
|---|---|---|---|---|
| L1 单元 | `cargo test --no-fail-fast` | 17 用例（auth 8 / 镜像 7 / Range 续传 2） | 17 passed / 0 failed | 本文件 §2；`src/mc/download.rs::resume_tests` |
| L2 CLI 契约 | `lycomc --schema` + 14 命令 | 14 命令（8 只读 / 6 写） | 14/14 真实执行通过 | `~/.cache/lycomc-schema.json`、`lycomc-cli-14.json` |
| L3 MCP | 换行 JSON-RPC 2024-11-05 | 8 条请求（含安全门/未知工具/ping） | 全部符合预期 | `~/.cache/lycomc-mcp-output.jsonl` |
| L4 Web API | 25 条路由 | 29 个探针 + 边界/突变 | 全绿，安全护栏生效 | `~/.cache/lycomc-web-mutation.json` |
| L5 前端 | shadcn 6 路由 CDP 实渲染 | 6 页 + 404 兜底 | 0 skeleton，皮肤 canvas 已绘制 | `~/.cache/lycomc-cdp/all-*.png` 6 张 |
| L6 TUI | PTY（设 winsize 40x120） | 14 命令菜单渲染 | 通过 | `~/.cache/lycomc-tui-pty.py` |
| L7 真实 E2E | 安装/启动/杀进程/Mod/汉化/设置 | 多轮异步 Job | 全链路 done | 见 §3、§4 |

## 2. 单元测试（17/17）

```
running 17 tests
mc::auth::tests::*                              8 ok  (设备码字段/OAuth 错误分类/协议字符串/
                                                      profile 皮肤/textures base64/内置 PNG/
                                                      SSRF 白名单/token 序列化不泄露)
mc::{meta,java,localize,modrinth}::mirror_tests 7 ok  (BMCL 重写/TUNA 目录/CFPA 三代理/
                                                      CDN data 前缀/版本新鲜度)
mc::download::resume_tests::*                   2 ok  (206 续传追加且进度计入/200 覆盖 stale)
test result: ok. 17 passed; 0 failed
```

后 2 个是 26.3 真实 bug 的回归测试：本地 `TcpListener` 起极简 HTTP，验证 `Range: bytes=have-`
返回 206 时追加、返回 200 时从头覆盖，防止「续传重复字节」或「旧字节残留」。

## 3. 26.3 安装失败（用户实测 P0）：OODA 闭环

用户报告（m02800）：安装 26.3 失败，`下载 .../26.3/26.3.jar 失败: error decoding response body`。

| OODA | 证据 | 结论 |
|---|---|---|
| Observe | 现场仅剩 `26.3.jar.part` = 13,434,308 B；`meta::client()` 有 `.timeout(60s)`；`Cargo.lock` reqwest 0.12.28 | 可疑：超时截断 |
| Orient | curl 官方完整 41,483,720 B 用时 164.96 s / 251,474 B/s；13.4 MB ≈ 60 s 下载量；BMCLAPI 302 回官方 piston-data；HEAD `content-md5`/`accept-ranges: bytes`、Range 0-1000 回 206 | 根因 = reqwest `.timeout()` 覆盖整个响应体，60 s 总超时把慢流截断，`bytes_stream` 报 `error decoding response body`。不是 CDN 断流，也不是 gzip 解码 |
| Decide | 最小修复：去掉总超时，改 `connect_timeout(20s) + read_timeout(120s)`（慢但连续传输不判死）；`stream_to` 加 Range 断点续传 + `.part` 可续传错误提示；加 2 个回归单测 | 不引入新依赖，不改安装协议 |
| Act | `src/mc/meta.rs`、`src/mc/download.rs` 落盘；`cargo test` 17/17；`cargo build` Finished dev 3.62s；二进制 36,136,008 B | 编译与单测通过 |
| Loop | 后台 `systemd-run --user --unit=lycomc-263` 真装：ExecMainStatus=0，`26.3.jar` = 41,483,720 B，`sha1 = e877b6a07acd633fb3bb475002175cec036e7b87`（与 version JSON 一致）；`list`/`info --version-id 26.3` 复核 | 真实 41 MB 安装成功，修复被证实 |

教训已固化：大文件真装必须后台异步（`systemd-run`），同步 `spawnSync` 会被 165 s 下载拖到 `tool call aborted`。

## 4. 真实 E2E 与边界（可逆、已复跑）

- 账号：POST/DELETE `E2EUser`；皮肤 `source=default fallback=true`；`POST /api/auth/microsoft/logout` 对离线账号原误返 200 → 修 `clear_session` 后明确 400（与 `ms_refresh` 语义一致）。
- 版本：POST `/api/versions/install 1.20.1` Job done 100；`DELETE /api/versions/WebDeleteProbe` 目录消失；`../evil` 路径穿越 GET/POST 均 400 非法版本 id。
- 启动：POST `/api/launch` → done pid=576103 → running=1 → `/api/launch/576103/kill` → running=0（真实 JVM 起停）。
- Mod：Modrinth sodium 安装/移除/再安装进度 0→100；Fabric 日志含 `Loading 10 mods:` 与 `Sodium: 42 options available`。
- 汉化：POST `/api/localize 1.20.1` → CFPA 包 → Sodium 中文包 → `{lang:zh_cn,localized:true}`。
- 设置：PUT `{memoryMb:1,maxConcurrent:0,downloadSource:evil,gameLang:BAD LANG}` 被 sanitize 为 `512/1/mojang/zh_cn`，且保留 `selectVersion`/`extraJvmArgs`。
- 安全：MCP 面 `settings-set` 被 T1 confirm 门拒绝；`/api/skin/image?url=http://127.0.0.1:8790/api/state` SSRF 仍回内置 PNG；`accounts.json` 0600 且不进 HTTP/CLI/SSE。
- 26.3 现状：`info` = `javaMajor:25`；`javas --json` 仅检测到 5 个运行时（Java 17×4 / 21×1），**无 Java 25**，需托管 JRE 25 或手动指定 JDK 25 才能启动。

## 5. 关于「全平台 / 服务器游玩 / 实机演示」的验收结论

这是 2026-11-12 晚用户 m03957 提出的新目标（比 PCL 更好 + Windows/Android/Linux/鸿蒙 + 实机演示 + Mod 加载 + 正版登录 + 服务器游玩），
**结论：当前未达成**，与本文已通过的「类 PCL 启动器核心链路」测试是两件事，不可混为一谈：

| 新目标项 | 现状 | 证据 |
|---|---|---|
| Linux 桌面 | ✅ 已达成 | 本机 Rust 二进制 + 6 页 Web + 实机截图 `lycomc-shot.png` / `lycomc-fabric-shot.png` |
| Mod 加载 | ✅ 已达成（Fabric/Sodium，1.20.1） | 真实 JVM 主菜单 + `Loading 10 mods:` 日志 |
| 正版登录 | 🟡 协议链路已实现并实测到 device-code/pending；最后一步必须用户本人在 microsoft.com/link 输入，未跑通完整授权 | `src/mc/auth.rs`、CDP 登录对话框截图 |
| Windows | ❌ 未达成 | 仅有 `x86_64-pc-windows-msvc` 已装 target，无 .exe 产物、无 Windows 实机 |
| Android / 鸿蒙 | ❌ 未达成 | 无 .apk/.hap、无对应 target 或构建配置 |
| 服务器游玩 / 联机 | ❌ 未达成 | 全仓 grep `server|multiplayer|easytier|邀请码|quickplay` 无实现（`meta.rs` 仅 `pub server: Option<Artifact>` 字段） |
| 四平台实机演示视频 | ❌ 未达成 | 用户发来的 `2026-11-12 21-31-00.mp4`（9m30s）主体是 Konsole `arch-update` pacman 列表 + `github.com/moeru-ai/airi` 网页，非四平台 MC 实机；contact sheet 19 格 18 格为终端/代码 |
| 比 PCL 更好 | ❌ 未达成 | `PCL-COMPARISON.md` 41 项对比：✅9/🟡16/❌14/➖2，核心链路覆盖，但差距集中在 PCL 的 Windows 桌面生态层 |

> 下一步需用户先明确核心验收口径（优先级 / 目标设备 / 是否接受分阶段），再按 lyco ROI 门槛决策，
> 不在未授权下擅自宣称「全平台已达成」或批量补齐缺失项。

## 6. 2026-11-13 后续回归（追加记录，不改写上面历史矩阵）

- 视觉/交互阶段新增默认账号生命周期 4 个单测、SettingsPatch 显式 null 语义 4 个单测：`cargo test --no-fail-fast` 由 17 → **25 passed / 0 failed**；`cargo build` 成功。
- 新增真实浏览器交互脚本 `/home/lilyco/.cache/lycomc-cdp/four-fixes.mjs`：账号快速切换四处同步、设默认/清除默认持久化、真实图标、页面退/入场动效与 reduced-motion，共 13 项。
- 第一次运行发现 3 项失败 → 定位 `PUT /api/settings` 的 `Option<Option<String>>` 把显式 null 当字段缺失 → `double_option` 修复；重启加载修复后的二进制，HTTP 9 次可逆探针全部符合契约，CDP 复跑 **13/13 checks=true**、error=null、原始默认账号复原。
- 证据：`/home/lilyco/.cache/lycomc-cdp/four-fixes-result.json`、5 张 `four-fixes-*.png`；逐项口径见 `docs/UI-MIGRATION.md` §7 与 `docs/DECISION.md` 末节。

## 7. 2026-11-13/14 桌面壳 · 教程 · 四端源码（追加记录）

本节记录「小白开箱即用 + 四端源码」这一轮的实际验收，不改写上面的历史矩阵。

### 7.1 桌面壳 WebView 黑屏（已修）

| 步骤 | 做法 | 结果 |
|---|---|---|
| 现象 | 窗口起来但整片空白，截图 mean=4.29e-06 / colors=17；嵌入式端口无 ESTAB | 排除后端未启动 |
| 对照 A | 纯 Python GTK3 + WebKit2 `load_html` 橙底 | 正常渲染（mean=0.510349，橙像素 210637）→ 环境本身没问题 |
| 对照 B | `examples/wry_min.rs` 跑 wry 两种建法 | `build()` 全黑；`build_as_child()` 红底正常 → 非 child 模式在本机 Xwayland 下把 webkit 的 GtkWindow 顶到宿主窗口 |
| 环境变量矩阵 | WEBKIT_DISABLE_COMPOSITING_MODE / LIBGL_ALWAYS_SOFTWARE / WEBKIT_DISABLE_DMABUF_RENDERER 四组 | 红像素都是 7937，无差异 → 排除渲染器开关假设 |
| 修复 | `src/desktop.rs` 改为 `with_bounds(...).build_as_child(&window)`，Resized 时同步 `set_bounds` | 首屏完整 UI，resize 不裁切不留黑边 |

### 7.2 桌面壳实机

- 启动：`systemd-run --user --unit=lycomc-desktop --collect`（DISPLAY=:0 / XAUTHORITY / GDK_BACKEND=x11），pid 172929，嵌入式端口 `127.0.0.1:36527`，`/api/health` 返回 `webMode:"embedded"`，且端口的实际地址与端口号不出现在 UI 与启动日志里。
- 窗口：WM_NAME「LilyCraft 启动器」，2360x1560；`XResizeWindow` 到 1800x1200 再复原，WebView 跟随（`set_bounds` 生效）。
- 侧栏点击（XTest 注入）：点「版本管理」真跳到 `#/versions`，三个实例行与每行操作按钮齐全。
- 关窗：`WM_DELETE_WINDOW` → 窗口从 `_NET_CLIENT_LIST` 消失，进程仍存活、`/api/health` 仍 200 → 关闭即最小化到托盘。
- 托盘：`org.kde.StatusNotifierWatcher.Get RegisteredStatusNotifierItems` 含本实例的 `org/ayatana/NotificationItem/tray_icon_tray_app_*`，托盘图标 PNG 已落盘。
- 快捷方式：`~/.local/share/applications/lilycraft.desktop`、`~/.local/share/icons/hicolor/scalable/apps/lilycraft.svg`、`~/Desktop/LilyCraft.desktop` 三个文件自动生成，`.desktop` 内容无技术术语（单测 `desktop_shortcut_body_has_no_technical_terms` 守住）。

### 7.3 教程与首启向导（真跑）

- 首启向导 3 步（认识它 / 取个名字 / 选个版本），首屏实测文案「欢迎来到 LilyCraft 启动器」「它是一个「帮你把 Minecraft 装好、开起来」的小工具…」，底部「跳过引导」+「开始 →」；点「开始」推进到第 2 步（步骤条实测「1 认识它 / 2 取个名字 / 3 选个版本」）。
- 教程页 `#/guide`：四步（第一次，把游戏装进来 / 想用正版账号 / 想加点新玩法 / 让游戏变成中文）+ 三条 FAQ + 「重看新手引导」；顶栏与侧栏都有入口。
- CDP 全流程（`/home/lilyco/.cache/lycomc-cdp/guide-check.mjs`，13 项）：onboardingVisible / onboardingClosed / onboardedFlag / guideHeading / guideSteps / reopenWorks / topbarGuideLink / sidebarGuideLink 全为真；六个路由加载后均无骨架屏残留。
- 截图：`guide-onb.png`、`guide-page.png`、`guide-topbar.png`、`guide-route_*.png`。

### 7.4 四端源码与打包配置

| 项 | 状态 | 证据 |
|---|---|---|
| Linux 桌面 | ✅ 实机验过 | 上述 7.2 全部实测 |
| Windows | 🟡 源码 + CI | `desktop.rs` 同一份源码 + workflow windows-latest；本机 `cargo check --target x86_64-pc-windows-msvc` 因无 MSVC `lib.exe` 失败，未产出 .exe |
| macOS | 🟡 源码 + CI | 同上，workflow macos-latest；无 mac 实机 |
| Android | 🟡 源码 + CI | `android/` Gradle + Kotlin WebView + JNI `nativeStart`；本机无 NDK/Gradle，仓库不含 APK |
| 浏览器 PWA | ✅ 实测 | `GET /manifest.webmanifest` → 200 `application/manifest+json` 543 B；`/` 的 head 含 manifest 与 theme-color |

- 打包配置 `packaging/Packager.toml` 与官方 schema 逐 key 比对通过（顶层 unknown = []，linux/deb/appimage/nsis/dmg 嵌套全 ok）；本机无 `cargo-packager`，未真实产出安装包。
- `.github/workflows/release.yml` 两个 job（desktop 10 步 / android 10 步）YAML 解析通过；只 upload artifact，不建 Release、不打 tag。
- `scripts/package-front.sh`、`scripts/build-android.sh` `bash -n` 通过并已 `chmod +x`。

### 7.5 守卫

`cargo fmt -- --check` 0 diff；`cargo clippy --all-targets -D warnings` 0 错；`cargo test --no-fail-fast` **27 passed / 0 failed**；`pnpm lint` 4 warnings / 0 errors（既有告警）；`pnpm build` 通过（`index-DXA7FZTF.js` 595.24 kB / `index-aXCjO_tR.css` 91.93 kB）。

## 8. 2026-11-14 Web 优先回归（追加记录，不改写上面历史矩阵）

> 本节对应 m06445「坚持 web 优先，客户端只作为 features」、m06446/m06447 的 longbridge/nsh 适用性提问、m05932 的图表 / 可商用 UI / 图标要求，以及 m05734 的充分测试与各平台口径。需求澄清、方案矩阵与不迁移 NSH 的理由见 `docs/DECISION.md` 的「Web 优先 · 桌面壳降为 feature · NSH 观察项」；本节只记录可复核的实测结果。新增证据原件路径、字节数与完整 64 位 sha256 见 `docs/TEST-EVIDENCE.json` 的「Web 优先 CDP / 默认入口回归」组；该文件原有历史组继续使用 16 位短哈希，未改写。

### 8.1 默认入口、回落与依赖门控

| 项 | 做法 | 实测结果 |
|---|---|---|
| 默认入口 | 默认构建的无参数二进制经 `systemd-run --user --unit=lycomc-web-first --collect` 启动，`LYCOMC_PORT=9390`、`LYCOMC_NO_OPEN=1` | `127.0.0.1:9390` LISTEN，MainPID 910788；`GET /api/health` 返回 `{"dataDir":"/home/lilyco/.local/share/lycomc","name":"lycomc","ok":true,"version":"0.1.0","webMode":"embedded"}` |
| 启动日志 | `/home/lilyco/.cache/lycomc-web-first.log` | 逐字为 `lycomc Web 控制台: http://127.0.0.1:9390` / `前端已编入二进制（webMode=embedded）` / `数据目录: /home/lilyco/.local/share/lycomc`，与 `api::serve()` 的默认 Web 入口一致；这是 CLI 诊断输出，Web UI 本身不把技术术语塞进页面按钮 |
| 可选桌面回落 | 未启用 feature 的默认二进制执行 `lycomc --desktop`，`LYCOMC_PORT=9391` | stdout 明确输出「（当前构建未启用桌面壳，已切换到浏览器界面；如需桌面壳请用 --features desktop 构建）」，随后正常打印 Web 控制台地址；stderr 为空 |
| CLI 不回退 | `lycomc --schema` 输出到 `/home/lilyco/.cache/lycomc-web-first-schema.json` | JSON 数组长度 14，14 个命令面保持完整 |
| 依赖门控 | `cargo tree --no-default-features -e normal` 搜索桌面依赖名；`ldd` 默认二进制 | 两者均无桌面依赖命中，后者记为 NO_DESKTOP_LIBS；显式 `cargo tree --features desktop -e normal` 才含 muda 0.20.0 / tao 0.37.2 / tray-icon 0.25.1 / wry 0.57.2。完整复跑命令：`cargo tree --no-default-features -e normal \| grep -E "wry\|tao\|tray-icon\|muda"` |
| 快捷方式 | `src/desktop.rs` 的 `shortcut_body()` 与单测 | Linux `.desktop` 的 Exec 显式带 `--desktop`；单测断言 `Exec="/opt/lycomc/lycomc" --desktop` 且不含 IP / 端口 |

- 验收副作用已清理：`systemctl --user stop lycomc-web-first` 后 unit 为 inactive；`web.port` 从 `9390` 恢复为原值 `8790`（原件备份 `/home/lilyco/.cache/lycomc-web-first-original-port.txt`）；`:9390` / CDP `:9394` 无残留监听；`accounts.json` 仍为 Steve（离线）/ lilyco42（微软）/ lilyco4242（离线），未创建测试账号。

### 8.2 双轨守卫（本机完整跑 `bash scripts/check.sh`）

- 日志原件：`/home/lilyco/.cache/lycomc-web-first-check.log`，末行 `lycomc local checks passed (web default + optional desktop feature)`。
- 默认 Web 构建：`pnpm install --frozen-lockfile` + `pnpm lint` + `pnpm build` + `cargo fmt -- --check` + `cargo clippy --all-targets -- -D warnings` + `cargo test --no-fail-fast` + `cargo build` 全绿；`cargo test` **25 passed / 0 failed**（默认不编译 5 个桌面单测）。
- 可选桌面构建：`cargo clippy --all-targets --features desktop -- -D warnings` + `cargo test --features desktop --no-fail-fast` + `cargo build --features desktop` 全绿；`cargo test` **30 passed / 0 failed**，含 `generated_icon_has_rgba_pixels`、`generated_icon_has_discrete_faces`、`focus_bridge_requests_only_for_editable_controls`、`brand_svg_has_no_gradient`、`desktop_shortcut_body_has_no_technical_terms`。
- 前端：`pnpm lint` 4 warnings / 0 errors（均为既有告警）；`pnpm build` 2600 modules，产物 `index-CFKLJDNN.js` 989.73 kB（gzip 293.09 kB）、`index-CVpxE2X8.css` 87.32 kB（gzip 14.90 kB）、`index.html` 0.85 kB；`git diff --check` CLEAN。

### 8.3 浏览器 CDP 主证据（Web 优先）

- 脚本与结果：`/home/lilyco/.cache/lycomc-cdp/web-first-cdp2.mjs`（Chromium 157.0.8103.38，独立 CDP 端口 9394 / profile，BASE `http://127.0.0.1:9390/#/`）输出 `/home/lilyco/.cache/lycomc-cdp/web-first-result.json`；pass 九项 `health / onboarding / nameInput / onboarded / guide / routes / chartCardFound / charts / all` 全部 true。
- 首启向导：visible / start / skip / steps 全真；第 2 步输入框 `value=Steve`、`placeholder=例如 Steve`、`focused=true`、`maxLength=16`。真实键盘序列：写入 `WebQA` → 主动 blur 后 `document.activeElement=BODY` → 点击回输入框并把光标移到末尾（`activeElement=INPUT`）→ 再写 `OK`，最终 `WebQAOK`。这是 **Web 浏览器界面**「离开输入框 → 回来 → 再输入」的干净证据，不是已降级的桌面壳输入 P0 结论。跳过引导后 `onboardedFlag=1`、onboarding 关闭，账号文件未污染。
- 教程：`#/guide` 四步与三条 FAQ 可见，顶栏 / 侧栏入口齐全；点「重看新手引导」后 `reopenWorks=true` 且向导重新出现。
- 七个 hash 路由（`/`、`/versions`、`/download`、`/mods`、`/settings`、`/guide`、`/no-such-page`）加载后 `skeletons=0`、标题均为「LilyCraft 启动器」；404 页文案「这个页面不存在 | 地址可能敲错了，回主页继续吧。」。`/api/state` 真实快照含 3 个版本、3 个账号、5 个 Java、0 个运行中进程、0 个 Job；CDP 观察到的 API 调用含 `/api/state`、`/api/health`、`/api/events`、皮肤与版本详情等 12 类路径。
- 12 张截图均为 1440x813，含 `web-first-onboarding.png`、`web-first-name-input.png`、`web-first-guide.png`、`web-first-home-chart.png` 与七路由截图；完整路径、字节数与 sha256 见 `docs/TEST-EVIDENCE.json` 新增组。

### 8.4 图表、可商用 UI 组合与实色图标

- 主页 `LauncherStatsCard` 的两张 recharts 图只聚合 `/api/state` 的真实快照：版本按原版 / Fabric 分饼图，Java 主版本按每个版本声明值分柱状图，不画没有后端数据支撑的「最近 7 天」时序。CDP 实测 `surfaces=2`、`pieSectors=4`、`barRects=4`，标签含「原版 / Fabric / 版本需要的 Java / 账号 / 运行中 / Java」。
- `web/package.json` 实测依赖许可标注：recharts 3.10.1 MIT、lucide-react 1.70.0 ISC、radix-ui 1.8.1 MIT、shadcn 4.23.0 MIT、react 19.3.1 MIT、tailwindcss 4.3.5 MIT、sonner 2.0.8 MIT、vite 8.3.7 MIT、@fontsource-variable/geist 5.3.0 OFL-1.1；这里记录上游标注，不替代商用前的许可证审阅。
- 顶栏 `BrandMark` 用六块离散实色（`#2078da` / `#9ec1ee` / `#5291df` / `#1662b6` / `#0b4a92` / `#ffffff`）；CDP 对图表卡与 BrandMark 实测 `linearGradient` / `radialGradient` 定义数均为 0，BrandMark `urlFill=false`、`paths=5`、`rects=1`；不使用纯色渐变图标。

### 8.5 跨平台、Windows 与 wine（按 Web 优先口径重写）

- `rustup target list --installed` 实测含 `aarch64-apple-darwin`、`aarch64-apple-ios`、`aarch64-linux-android`、`aarch64-unknown-linux-ohos`、`x86_64-apple-darwin`、`x86_64-linux-android`、`x86_64-pc-windows-msvc`、`x86_64-unknown-linux-gnu`；但本机 `x86_64-w64-mingw32-gcc`、`xcrun`、`cargo-ndk`、`gradle` 均 MISSING，`wine` 在 `/usr/bin/wine`。
- 本机 `cargo check --target x86_64-pc-windows-msvc --lib` 仍报 `failed to find tool "lib.exe": No such file or directory (os error 2)`，未产出 `.exe`；macOS 无实机、Android 无 APK、鸿蒙无 Rust wry backend。Web 优先后，Windows / macOS 用户的交付门槛是浏览器能打开同一套 Web 控制台 + 本机服务在运行；wine 可跑 Web UI 或 exe，但都不是主线和验收门槛，也不承诺签名安装包。
- m03957 的「全平台实机演示 / 服务器游玩」需按 Web / PWA 浏览器优先重新界定；m04829 / m04836 的 Android 形态、Win/mac 是否必须出安装包、下一步优先级三问仍待用户确认。本节不把「源码 + CI」写成「已出安装包」。

### 8.6 明确不宣称的内容

- 桌面壳输入焦点 P0 已由 m06445 降级冻结：`p0bs.png` / `p0input.png` 停在向导 step=0，是无效复验证据；已编译的焦点桥与 30 / 30 单测保留在可选 feature 里，但本节不宣称桌面 GUI「离开 → 回来 → 输入」已干净验收。
- `docs/DECISION.md` 历史节「桌面双击 / 裸跑优先原生窗口」作为 2026-11-13 决策保留；本节 §7.5 的 27 passed 也是历史值，不与本轮 25 / 30 双轨数值混淆。longbridge/nsh 仅列为未来原生壳观察项，本轮不迁移、不复制代码、不引入 nsh CLI / 运行时。
