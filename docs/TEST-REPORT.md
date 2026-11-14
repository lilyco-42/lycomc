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

## 9. 2026-11-14 本机 Web 可执行程序优先回归（m06729；§8 历史矩阵不改写）

### 9.1 默认入口与跨平台默认浏览器

- 同一个默认二进制优先形态是「本机 Web 可执行程序」：Linux ELF / Windows `.exe` / macOS 二进制启动本地服务，再由平台默认浏览器打开；不是原生桌面客户端。Windows `.exe` 允许存在，但需 Windows 工具链或 CI 产出，当前 Linux 主机仍缺 MSVC `lib.exe`。
- `src/api.rs` 的 `maybe_open_browser` 增加平台分支：Linux `xdg-open`、Windows `rundll32 url.dll,FileProtocolHandler`、macOS `open`；Windows / macOS 不依赖 DISPLAY；`LYCOMC_NO_OPEN=1` 可关闭自动打开。Windows / macOS 的 cfg 分支用 `rustc --emit=metadata --target x86_64-pc-windows-msvc|aarch64-apple-darwin` 编译验证（WINDOWS_CFG_OK / MACOS_CFG_OK），仅验证条件编译，不代表出包或实机。
- Linux 实机 stub 实测：PATH 前置 `xdg-open` 记录脚本，默认二进制以临时数据目录和 `LYCOMC_PORT=9438` 启动后，stub 收到 `http://127.0.0.1:9438`；同端口 `/api/health` 返回 `webMode=embedded`，`web.port=9438`，无原生窗口依赖。
- `scripts/smoke-web.sh` 增加临时数据目录的最小开箱 smoke，最终二进制复跑 `lycomc Web smoke OK`，不打开浏览器、不碰真实账号与版本。

### 9.2 双轨守卫与已交付能力复核

- `bash scripts/check.sh` 全绿（日志 `/home/lilyco/.cache/lycomc-web-exe-check.log`）：默认 `cargo test` **26 passed / 0 failed**（新增 `api::browser_launch_tests::default_web_binary_uses_platform_browser`），可选 `--features desktop` **31 passed / 0 failed**；`cargo fmt -- --check` PASS、`cargo clippy --all-targets -- -D warnings` 0 错、`git diff --check` CLEAN。
- `scripts/check.sh` 末尾补一次默认 `cargo build`，避免双轨检查把 `target/debug/lycomc` 留在 desktop 形态；文档收尾后重跑的 `/home/lilyco/.cache/lycomc-web-final/final-guard.log` 仍 `EXIT=0`，紧接着实测默认二进制 `sha256=edbacdee…`、`ldd` NO_DESKTOP_LIBS、`--schema` 14 命令。
- 前端 `pnpm lint` 4 warnings / 0 errors（既有告警）、`pnpm build` PASS；`touch build.rs && cargo build` 重新嵌入 web/dist；`ldd` 默认二进制 NO_DESKTOP_LIBS；`--schema` 14 命令；`src/api.rs::router` 26 条路由，覆盖 SSE、微软设备码登录、账号皮肤、Modrinth、设置与本地化。目标里的「25 路由」是历史基线口径：dabe2a0 与当前 router 都是 26 条、逐行 diff 为 0，能力只增不减，不构成回退。
- 单测清单含 `mc::auth::*`（设备码字段、token 不泄漏、oauth 错误分类、皮肤变体、SSRF 白名单、内置 PNG）与 `settings::tests::*`；源码 / 文档保留正版登录与皮肤展示能力，不在本轮重复触发真实微软设备码的人工授权步骤。

### 9.3 最终二进制独立 CDP 与后端探测

- 独立服务 `lycomc-web-final` 用 `127.0.0.1:9440`、`LYCOMC_NO_OPEN=1`；health 返回 `webMode=embedded`。独立 Chromium CDP `127.0.0.1:9444` 与结果目录 `/home/lilyco/.cache/lycomc-web-final`，没有覆盖已提交 `web-first-*` 证据。
- CDP `web-final-result.json` 九项 `pass` 全 true：首启向导、名字输入真实键盘 `WebQA` → blur BODY → 回 INPUT → 追加 `OK` 得 `WebQAOK`、onboarded 持久化、教程四步与重看引导、七路由（含 404 兜底，skeletons=0）、两张 recharts 图表（surfaces=2 / pieSectors=4 / barRects=4）、BrandMark 离散实色（gradientDefs=0、urlFill=false、paths=5、rects=1）。
- 浏览器实际调用 13 个 `/api/*` 端点，含 `/api/events`、三个账号的 `/api/accounts/{name}/skin`、`/api/skin/image`、`/api/state`、版本详情、Modrinth 与 Mods；后端只读探测 11/11 返回 200，`/api/events` 响应头 `content-type: text/event-stream`，`/api/state` 为 3 版本 / 3 账号 / 5 Java / 0 运行中 / 0 Job 的真实快照。
- 12 张 `web-final-*.png`、CDP 脚本、日志、结果、SSE 响应头、cfg probe 元数据、smoke 日志、最终守卫日志与默认二进制快照共 29 项登记到 `docs/TEST-EVIDENCE.json` 第 8 组，全部使用完整 64 位 sha256；既有第 7 组 18 项完整哈希逐项复核仍 ok=18 / bad=0，前 6 组历史短哈希口径不变。

### 9.4 清理与边界

- 验收服务已停止，真实 `web.port` 从 `9440` 恢复为 `8790`；`9440` / `9444` / `9450` 无残留监听；Chromium profile 与临时数据目录都在 `/home/lilyco/.cache/lycomc-web-final`，未写入用户数据；账号仍是 Steve（离线）/ lilyco42（微软）/ lilyco4242（离线），没有新增测试账号、没有打印 token。
- 不宣称 Windows / macOS / Android / 鸿蒙实机安装包或签名包已产出；不宣称原生桌面壳输入焦点 P0 已完成干净 GUI 复验（m06445 已降级冻结）；m03957 全平台实机演示与 m04829 / m04836 三问仍待用户重新界定。

## 10. 2026-11-14 一键直连多人服务器（quickPlay）回归（§8 / §9 历史不改写）

> 本节是 m06887「继续」后推进的 m03957「服务器游玩」最小闭环；§8 的 25 / 30 与 §9 的 26 / 31 都是历史数值，本节不改写。

### 10.1 改动与双轨守卫
- 9 个文件：src/api.rs、src/commands.rs、src/mc/launch.rs、src/mc/meta.rs、src/settings.rs 与 4 个 web/src 文件；git diff --stat 399 insertions / 24 deletions（文档另计）。
- bash scripts/check.sh 全绿，日志 /home/lilyco/.cache/lycomc-web-server/quickplay-guard.log（10257 B，sha256 0db76b20…）：默认 cargo test **35 passed / 0 failed**，--features desktop **40 passed / 0 failed**（新增 9 个 quickPlay / 设置语义单测）；cargo fmt -- --check PASS、cargo clippy --all-targets -- -D warnings 0 错（首跑的 2 个 clippy 提示已修：enabled.iter().any → contains、手动 Option::map → map）、git diff --check CLEAN。
- pnpm lint 4 warnings / 0 errors（均为既有告警）、pnpm build 2600 modules，产物 index-B6_XqSyM.js 992.14 kB（gzip 293.76 kB）、index-BIRyMoZJ.css 87.41 kB（gzip 14.91 kB）、index.html 0.85 kB；touch build.rs && cargo build 已把新 dist 编进默认二进制。
- 默认二进制 sha256=be2690ac…、ldd NO_DESKTOP_LIBS、--schema 仍 14 命令、src/api.rs::router 仍 26 条 .route；SSE、微软设备码、皮肤、Modrinth、设置与本地化端点未删减。

### 10.2 真实实例 CLI --dry-run 矩阵
- 临时 LYCOMC_DATA_DIR=/home/lilyco/.cache/lycomc-web-server/cli-data，versions/1.20.1 与 versions/fabric-loader-0.20.1-1.20.1 符号链接到真实实例，assets / libraries / java 软链真实数据；不 spawn 游戏、不打印 token。结果在 cli-dry-run.json / cli-default-server.json。
- 1.20.1 --server mc.hypixel.net → --quickPlayMultiplayer 后跟 mc.hypixel.net（index 34），且不含 --demo / --width；省略 --server 且无默认值 → index -1；显式 --server 空串 → index -1（覆盖默认值）；fabric-loader-0.20.1-1.20.1 --server fabric.example.net:25565 → index 35 后跟该地址（证明父版规则经 install::merge 对 Fabric 生效）；临时设置写 quickPlayServer=default.example.net 后省略 --server → index 34 后跟 default.example.net；--server 后接形似选项的值被 clap 拒绝（exit 2、unexpected argument 提示），不是后端注入。
- 真实 /home/lilyco/.local/share/lycomc/settings.json sha256 662e2ffc… 与 web.port=8790 均未变。

### 10.3 隔离 HTTP + fake-Java 探针（不真启动 MC）
- 直接 detached 启动 start-server.sh：127.0.0.1:9470、LYCOMC_NO_OPEN=1、临时 http-data，settings.javaPath 指向 fake-java.sh（-version 输出 17，其余 argv 逐行写盘后立即退出）；health webMode=embedded。首次失败已定位为 process.execPath 是 Electron 宿主，跑 .mjs 必须用 /usr/bin/node；systemd-run transient unit 会被回收，改用 detached bash。
- 设置语义 5/5：initial null → PUT quickPlayServer=default.example.net → 只改 memoryMb 的 patch 保持默认值 → 显式 null 清空 → 非法地址被 sanitize 成 null；最终再把 quickPlayServer 复位为 null。
- 只读端点 9/9 返回 200；/api/events 响应头 content-type: text/event-stream（curl 超时 28 属预期）。
- POST /api/launch 7/7 用例，全部 job.state=done，从 job「命令:」行与 fake-Java argv 双向核对：缺省回落默认值 default.example.net（index 32）、显式 null / 空串覆盖为不直连、显式 server=mc.hypixel.net 覆盖默认值、非法地址与形似选项的地址被丢弃、Fabric 继承父规则得到 fabric.example.net:25565（index 33）。所有用例均不含 --demo / --quickPlaySingleplayer / --quickPlayRealms / --width / --evil。

### 10.4 独立 Chromium CDP 真实交互
- web-server-cdp.mjs 用 CDP 127.0.0.1:9474、独立 profile 与结果目录 /home/lilyco/.cache/lycomc-web-server，截图前缀 web-server-，没有覆盖 web-first-* / web-final-* 证据。
- pass 11 项 quickPlayHome / quickPlaySettingsSave / health / onboarding / nameInput / onboarded / guide / routes / chartCardFound / charts / all 全 true；15 张截图。
- 新增交互：主页 aria-label=直连服务器 输入 ui.example.net:25565（placeholder 例如 mc.hypixel.net、零术语说明可见）→ 设置页 aria-label=默认直连服务器 输入 default.example.net 并点精确文案「保存」→ savedValue=default.example.net → reload 后主页回落 homeFallback=default.example.net。
- 已交付能力不回退：首启向导与真实键盘 WebQA → blur → 回 INPUT → OK、跳过引导持久化、#/guide 重看引导、七路由（含 404、skeletons=0）、两张 recharts 图（本次隔离数据 surfaces=2 / pieSectors=4 / barRects=2，数值随实例数变化）、BrandMark gradientDefs=0 / urlFill=false。浏览器实际调用 13 类 /api/* 端点，含 /api/events 与皮肤代理。

### 10.5 证据、清理与边界
- docs/TEST-EVIDENCE.json 追加第 9 组「一键直连多人服务器 / quickPlay 独立验收（2026-11-14）」40 项：quickplay-guard.log、schema、CLI / HTTP / CDP 结果与脚本、fake-Java argv、15 张 web-server-*.png、清理与真实数据基线，全部完整 64 位 sha256，逐项复核 ok=40 / bad=0；第 7 / 8 组仍 ok=47 / bad=0，前 6 组历史短哈希口径不动。
- 清理：serverKilled=true、unitActive=inactive、9470 / 9474 端口空闲、无 MC 残留进程、realDataUnchanged=true（settings.json / accounts.json / 两个 options.txt / web.port 前后哈希一致）、临时 web.port=9470、真实 web.port=8790；账号仍 Steve（离线）/ lilyco42（微软）/ lilyco4242（离线），未新增账号、未打印 token。
- 不宣称已连接真实多人服务器或产出进服后游戏截图（fake-Java 只验启动参数与 job 命令）；不宣称 Windows / macOS / Android / 鸿蒙实机或签名安装包；m03957 其余部分与 m04829 / m04836 三问仍待用户重新界定。

## 11. 2026-11-14 真实本机联机补证（quickPlay 实机进服；§8 / §9 / §10 历史不改写）

> 本节只补 e45976b 提交之后的实机验收证据，没有修改产品源码、API、命令或前端；默认二进制仍是 e45976b 的 sha256=be2690aca8721f84c57c89e1e87f4a0df4c914e8be69d6d1d70db17703a2b2c6、ldd NO_DESKTOP_LIBS、--schema 14 命令。

### 11.1 隔离环境与前置条件
- 独立目录 /home/lilyco/.cache/lycomc-live-server；LYCOMC_DATA_DIR 指向其 data/，LYCOMC_PORT=9490、LYCOMC_NO_OPEN=1；data/versions/1.20.1 是真实实例副本，libraries / assets 软链真实只读资源；data/accounts.json 只含离线账号 Steve，online-mode=false 的本机服务端使用扁平世界、和平难度。
- 官方 1.20.1 server.jar 47791053 B，sha1=84194a2f286ef7c14ed7ce0090dba59902951553、sha256=3af73a9dc5a102e38147946360dd27d4d70bae7055bf91cf2151cd5d121b79e0；piston-data.mojang.com 直连 TLS 35 失败，改用 launcher.mojang.com 同 sha1 下载成功。
- Web API /api/health 返回 webMode=embedded，数据目录为隔离目录；真实 /home/lilyco/.local/share/lycomc/web.port 保持 8790。

### 11.2 真实启动与进服链路
- 服务端 /usr/bin/java -Xmx1024M -jar server.jar nogui 在 3.4 s 内完成 Done (3.380s)! For help, type "help"，25565 监听。
- POST /api/launch {versionId:"1.20.1",accountName:"Steve",memoryMb:2048,server:"127.0.0.1:25565"} 返回 jobId；job state=done、client pid=1386179、日志路径 /home/lilyco/.cache/lycomc-live-server/data/logs/1.20.1-1794670046.log；job 命令含 --quickPlayMultiplayer 127.0.0.1:25565，凭据已替换为 <redacted>。
- 客户端日志出现 Connecting to 127.0.0.1, 25565；服务端日志出现 Steve[/127.0.0.1:49372] logged in with entity id 1 at (-9.5, -60.0, -7.5) 与 Steve joined the game。
- KWin Scripting loadScript 返回 (2,)、unloadScript 返回 (true,)；激活后 xprop -root _NET_ACTIVE_WINDOW 为 0x1a00007，WM_NAME 含「Minecraft 1.20.1 - 多人游戏（第三方服务器）」。spectacle --activewindow 得到 live-join.png（246817 B，sha256=bd887a4b93a2553d7f12981484683b5d600ceab1d8c081c5bee0fecf8131bc9d）与缩略图 live-join-small.png（296512 B，sha256=b47437b72a71379ad2ef47a2789b265cc3ff5bd99bef77cf319da69dee7a8a1d）；缩略图 magick identify mean=22684.4、colors=12669，画面可见多人游戏 HUD 与无法验证聊天消息提示。

### 11.3 清理、安全与不污染真实数据
- POST /api/launch/{pid}/kill 返回 200 / {"ok":true}；随后服务端、Web 服务、客户端进程均退出，25565 / 9490 无残留监听，无 server.jar / net.minecraft.client.main.Main 残留进程。
- 严格凭据扫描规则为「字面离线凭据或凭据参数后跟 8 位以上原始字符」，运行产物、隔离账号 / 设置、说明与 manifest 共 9 个文本证据命中 0；验收 harness scripts/live-run.mjs 中作为脱敏规则字面量的两段拼接字符串出现 3 次，不做产品运行时凭据计入，且未读取或打印真实微软账号 token。
- 真实 settings.json / accounts.json / versions/1.20.1/options.txt / web.port 四项 sha256 与验收前完全一致，realDataUnchanged=true；临时 world、日志与截图都留在独立 cache 目录。

### 11.4 证据与复核
- docs/TEST-EVIDENCE.json 以 e45976b 原文文本追加第 10 组「真实本机联机补证 / quickPlay 实机进服（2026-11-14 深夜，m06887 / m03957 子项）」，共 19 项，全部使用完整 64 位 sha256；前 9 组原始文本前缀与后缀逐字不变（prefixSame=True，suffixSame=True，first9JsonSame=True），只在第 9 组后插入一行 JSON 数组分隔符。
- evidence-manifest.json 自身不列入 manifest.files（避免自引用），其 sha256=66179874ee4a320a8f8f364611ff73129aff180cb8c8531c9418fd01695dc6bf、bytes=4037 已登记在第 10 组；run-result.json sha256=431041eee1576cf569f24b99d8b41a3f5f229e9e10ede7a60d3312b3f2410282、live-server.log sha256=670ed9e823fb94c813bf8c6a9293d51d861e6215040bbd3e717541653a9dcba9、live-client.log sha256=a1760dbeee534db312d009e6ec43016eae382c3cf1eab0731a2710e2c7bf683d、scripts/live-run.mjs sha256=2a4668d77c05bb2c0b1533b7a64bdcb38316718487b0ca82beb01421aab23a2d。
- 第 7 / 8 / 9 / 10 组全部完整 64 位哈希逐项复核：ok=106 / bad=0；第 10 组 all64=True、selfRefs=0；前 6 组历史 16 位短哈希口径仍不动。python3 -m json.tool 与 git diff --check 通过。

### 11.5 边界
- 这是本机 1.20.1 离线模式独立服务端的实机联机补证，证明 Web/CLI 的 server 参数能驱动真实客户端直连并进入多人游戏；不宣称公网 Hypixel / 正版账号联机、服务器浏览器、好友组队或内网穿透。
- 不宣称 Windows / macOS / Android / 鸿蒙实机或签名安装包已产出；m03957 全平台实机演示、m04829 / m04836 三问（Android 形态、Win/mac 安装包、快捷方式口径）仍待用户重新界定；桌面壳输入 P0 继续按 m06445 降级冻结。
