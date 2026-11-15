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

## 12. 2026-11-15 测试完成报告：性能 / 稳定性优化与 GitHub Actions Release（§8–§11 历史不改写）

### 12.1 测试对象与完成口径

- 触发需求：m07261「写出测试完成报告、做好各种功能 / 性能 / 对比测试，接下来发布 GitHub Runner Action Release 和性能优化、稳定性优化」；不改写 §8 Web 优先、§9 本机 Web 可执行程序、§10 quickPlay 独立回归、§11 真实本机联机补证。
- 本机环境：Linux 16 CPU / 23 GB RAM；默认 Web 二进制为 debug build；性能对比注入一个 `JAVA_HOME/bin/java`，该候选执行 `sleep 5`，用于放大 Java 探测对 `/api/state` 的尾延迟。结论只适用本机 Linux debug 二进制与慢 Java 压力场景，不等同 release build、Windows / macOS / Android / 鸿蒙实机或公网正版联机基准。
- 基线二进制 `/home/lilyco/.cache/lycomc-perf/baseline-lycomc`：40159856 B，SHA-256 `be2690aca8721f84c57c89e1e87f4a0df4c914e8be69d6d1d70db17703a2b2c6`。
- 最终优化二进制 `/home/lilyco/.cache/lilyco-build/target/debug/lycomc`：40651824 B，SHA-256 `f4442166d9ccd1a04659eece8ad02e46dcc11547c435c13d8d369fcfab9aa649`；`ldd` 无 WebKit / GTK / appindicator / libxdo，`--schema` 仍为 14 命令，后端 `router` 仍为 26 条 `.route`，Web-first 能力不回退。
- 完成判定：本机双轨守卫、功能对比、性能对比、稳定性边界测试、独立 CDP 回归、workflow / shell / Node / YAML / JSON / 差异检查全部通过；GitHub Actions 与 Release 的远端运行结果以实际推送后的 workflow 和 Release 资产为准，不以本机结果冒充远端成功。

### 12.2 测试完成矩阵

| 类别 | 结果 | 证据 |
| --- | --- | --- |
| 全量双轨守卫 | `bash scripts/check.sh` EXIT=0；pnpm lint 4 warnings / 0 errors；pnpm build 2600 modules；默认 cargo test 40 passed / 0 failed；`--features desktop` 45 passed / 0 failed；cargo fmt / clippy `-D warnings` / build 双轨通过；脚本末尾恢复默认 Web-only 二进制 | `final-guard.log` SHA-256 `715a8580b5171fa7f536882f4e5c794a5dde761d4af225ef0f212d389b8bc9c6` |
| 独立运行时 smoke | `LYCOMC_PORT=9560 bash scripts/runtime-smoke.sh` EXIT=0，`/api/health` 返回 `name:lycomc` / `webMode:embedded`；消除了 web.port 启动竞态的无害 stderr | `runtime-smoke-final.log` SHA-256 `bad1d1526e8965e8019496504584e131b2fa496dc95d864d97e4c140822709bf` |
| 后端功能对比 | baseline 与 optimized 均为：5 项设置语义通过、9/9 只读端点通过、SSE `text/event-stream` 通过、7/7 quickPlay 启动用例通过、最终设置清空 / 运行中列表为空 / health / healthAfterLoad 全通过 | `compare/compare-result.json` SHA-256 `271b19043eeef04d85244a09c5096f9dd555151869075aa33e4b0fff0bb53757` |
| 浏览器功能回归 | 最终二进制独立 CDP：health / onboarding / nameInput / onboarded / guide / routes / chartCardFound / charts / all 九项全 true；真实键盘 `WebQA → blur BODY → 回 INPUT → WebQAOK`；7 路由、2 recharts surfaces、4 pie sectors、4 bar rects、BrandMark `gradientDefs=0` | `cdp-final/final-result.json` SHA-256 `733903b6d5bb13e790c96596b78b4cdf0942a16a057a33c6a76c9126d792ba3d`，12 张 `final-*.png` |
| 稳定性边界 | Java 探测 2 s 超时；1 MiB stdout + 1 MiB stderr 不死锁；`sleep 5` 慢候选与 detached descendant holding pipes 均在 3 s 内返回；SSE 纯百分比广播 100 ms 节流但日志 / 100% / done / error 事件精确 | 默认 40 / desktop 45 单测，含 `probe_drains_large_output_without_deadlock`、`probe_times_out_slow_candidate`、`probe_bounds_detached_descendant_holding_pipes`、`progress_throttles_but_terminal_events_are_exact` |
| 隔离与清理 | 对比使用独立数据目录、fake Java、离线 Steve 账号；`realDataUnchanged=true`，真实 settings.json / accounts.json / web.port / options.txt 哈希不变；9510 / 9512 / 9530 / 9534 / 9550 / 9554 / 9560 端口空闲，无残留服务 / Chromium / fake Java / Minecraft 进程 | `compare/cleanup.json` SHA-256 `47875232b8dd2f9f7ffca1af7d6cdbb7a6a6a3e7bebe1fccdd0d1bfa7ac90292`；`cdp-final/cdp-final-meta.json` |
| 发布前静态校验 | PyYAML 解析 `ci.yml` / `release.yml` 通过且 release 无 `|| true`；`bash -n` 三个 shell 脚本通过；`/usr/bin/node --check scripts/compare-binaries.mjs` 通过；`git diff --check`、`python3 -m json.tool docs/TEST-EVIDENCE.json` 通过 | `check_workflows.py` 输出 `YAML_OK` / `NO_MASKED_FAILURES` |

### 12.3 性能对比结果（最终二进制 f4442166…）

`/home/lilyco/code/lycomc/scripts/compare-binaries.mjs` 在两台隔离服务上分别跑 baseline 与 optimized：5 次串行 `/api/state`、8 个并发 `/api/state`、2 次静态资源预热 + 24 次串行静态资源 / 16 个并发静态资源，采集 p50 / p95 / worst、RSS 与加载后 health。

| 指标 | baseline | optimized | 改善 |
| --- | ---: | ---: | ---: |
| `/api/state` p50 | 10098.697 ms | 1.575 ms | 99.984% |
| `/api/state` worst | 10177.991 ms | 2012.117 ms | 80.231% |
| 8 并发 `/api/state` 总耗时 | 20213.766 ms | 5.172 ms | 99.974% |
| 静态资源 p50 | 2.489 ms | 1.281 ms | 48.534% |
| 静态资源并发吞吐 | 387.491 MiB/s | 502.419 MiB/s | +29.66% |
| 常驻 RSS | 22781952 B | 19550208 B | -3231744 B |

机制说明：baseline 在 axum async worker 上串行执行 `java -version`，慢候选会把 `/api/state` 拖到 10 s 量级；优化把 `state_all` 的磁盘 / Java 扫描放进 `tokio::task::spawn_blocking`，Java 探测限 2 s 且 Unix 进程组 SIGKILL，候选并行度上限 4，30 s 内按数据目录缓存，静态资源由 `include_dir!` 的 `static [u8]` 零拷贝返回，SSE 纯百分比快照 100 ms 节流。`stateWorstAfterMs` 约 2012 ms 是首次 / 缓存过期时受控的 2 s 慢 Java 探测，不是旧的 5 s 无界挂起。

### 12.4 优化与稳定性改动范围

- `src/mc/java.rs`：`PROBE_TIMEOUT=2s`、`SCAN_TTL=30s`、按 `LYCOMC_DATA_DIR` 键缓存、候选并行探测；`pub fn scan_system()` 用缓存，`pub fn scan_system_fresh()` 供 `pick()` 在启动前立即看到新装 JRE；探测进程使用独立 pipe reader，慢候选超时时 `kill` + Unix process-group SIGKILL，避免 shell 后代继承 fd 造成 pipe hang。
- `src/api.rs`：`state_all` 把账号 / 版本 / Java 扫描移入 `spawn_blocking`；`static_file` 改为 `(StatusCode::OK, f.contents()).into_response()`，利用 `include_dir!` 静态字节避免每请求复制约 1 MB JS；`router` 仍为 26 条 `.route`，无端点删除。
- `src/jobs.rs`：`PROGRESS_MIN_INTERVAL=100ms` 仅节流纯百分比广播；日志、`100%`、完成 / 错误快照保持精确，满足前端 `use-job.ts` 的 logs 单调合并语义。
- `Cargo.toml` / `Cargo.lock`：`lilyco` 依赖从本机绝对路径改为公开 Git rev `1fc383e44b51dbfe249562b4ca0ef5c271a712e9`，GitHub Runner 可复现解析；`cargo check --locked --all-targets` 已在本机通过。
- `.github/workflows/ci.yml`：push / PR / workflow_dispatch 在 ubuntu-24.04 执行 `scripts/check.sh` 与 runtime smoke，安装 WebKitGTK 依赖以支持可选 desktop 双轨检查；不再用 `|| true` 掩盖失败。
- `.github/workflows/release.yml`：`v*` tag push 或 `workflow_dispatch` 指定已存在标签；matrix 为 ubuntu-24.04 / x86_64-unknown-linux-gnu、windows-latest / x86_64-pc-windows-msvc、macos-15 / aarch64-apple-darwin；构建 release Web 可执行程序、运行时 smoke、打包二进制 + README、生成 SHA-256、上传 artifacts 并创建 / 更新 GitHub Release。macos-15 是 Arm64 runner label，`macos-14` 为 x64 且已标记 deprecated，见 `runner-images-README-excerpt.txt`。

### 12.5 证据登记与边界

- 第 11 组证据由 `/home/lilyco/.cache/lycomc-perf/evidence-group11-manifest.json` 生成：清单本身 7066 B，SHA-256 `1c433eb9417ab0cc715122eebc114fac9d9651d24b62ba2c472307df3384dce7`；36 个文件均使用完整 64 位 SHA-256，清单本身作为第 37 项追加到 `docs/TEST-EVIDENCE.json`，前 10 组逐字节保留。
- 本机未产出 Windows `.exe` / macOS 二进制 / Android / 鸿蒙包；release 三平台产物只应由 GitHub Runner 的 `release.yml` 生成并在 Release 页面复核。真实本机 1.20.1 服务器联机证据仍为 §11，不因 fake Java 对比重写。
- 远端 GitHub Actions / Release 运行结果在推送与 tag 后用 `gh run` / `gh release view` 复核；若任一 job 失败，必须按失败日志修复并重新发布，不能把本机 YAML 校验当作 runner 成功。

## 13. 远端发布完成报告（2026-11-15，m07261 收口）

> 本节为 §12 的纯追加。§12 记录的是优化前/后的本机回归与发布前边界；本节记录首次远端 Release 暴露 Windows 编译问题后的修复、三平台正式发布成功与下载资产复核。历史 §8 / §9 / §10 / §11 / §12 的表格与结论均不改写。

### 13.1 首次发布失败的根因与修复

- 首次 tag v0.1.0（旧对象 63cc7082883c72a0df4c374c46102489f45c5c58，指向 2a5cef83eb0ef266e6525cf532b2e17608e0014e）触发 Release run 43635688234：Linux / macOS build 成功，Windows build 失败，publish skipped，gh release view v0.1.0 为 release not found。

- 精确编译错误：src/api.rs:551:15 的 libc::kill(pid as i32, libc::SIGTERM); 与 src/api.rs:563:23 的 libc::kill(pid as i32, libc::SIGKILL); 触发 error[E0425]: cannot find function kill in crate libc；src/api.rs:563:46 触发 error[E0425]: cannot find value SIGKILL in crate libc。Windows 的 libc 只有 pub const SIGILL: c_int = 4;，rustc 建议替换为 SIGILL 是错误语义，未采纳。

- 根因：POST /api/launch/{pid}/kill 的 kill_launch 原先无条件调用 POSIX kill / SIGTERM / SIGKILL，Linux / macOS 双轨检查与本机测试没有覆盖 Windows cfg。src/mc/java.rs 的 process-group SIGKILL 已有 #[cfg(unix)]，src/api.rs 是唯一遗漏。

- 修复提交 f6640ab306c7ca2bdb1380d98f82d46a78fd7556：在 src/api.rs:537-653 增加 #[cfg(unix)] fn signal_game(pid: u32, sig: libc::c_int) -> Result<(), String>、request_game_exit 与 force_game_exit；Unix 用 libc::kill 且对 ESRCH 视为已退出、拒绝 pid_t 越界以防误杀进程组。Windows 用 #[cfg(windows)] fn taskkill_game(pid: u32, force: bool) -> Result<(), String> 调绝对 %SystemRoot%\System32\taskkill.exe /PID <pid> /T 并可选 /F，CREATE_NO_WINDOW=0x0800_0000；其他平台显式返回不支持。保持 PID 控制而非 Arc<Mutex<Child>>，因为 src/api.rs:471-496 的 reaper 已持有 Child 并调用 child.wait()，共享锁会死锁；不新增 windows-sys 依赖以免 Cargo.lock 扰动。

- 新增 src/api.rs:1469-1510 #[cfg(all(test, unix))] mod process_control_tests 三项：忽略 SIGTERM 的子进程仍被强制退出、缺失进程幂等成功、u32::MAX 在发信号前被拒绝。src/mc/java.rs:451-454 把 Windows cfg 下未用的 probe / Instant 测试 import 加 #[cfg(unix)]，消除 cargo check --all-targets 警告。

- 稳定性门禁：.github/workflows/ci.yml:63-99 新增 cross-compile matrix（windows-latest / x86_64-pc-windows-msvc、macos-15 / aarch64-apple-darwin）执行 pnpm install --frozen-lockfile、pnpm build、cargo check --locked --all-targets --target；.github/workflows/release.yml:24-64 新增 Linux / Windows / macOS 三项 compile guard，build 显式 needs: guard，任一编译失败不会再产出残缺 Release。

### 13.2 修复后本机回归与跨平台验证边界

- bash scripts/check.sh EXIT=0：pnpm lint 4 warnings / 0 errors、pnpm build 2600 modules、默认 cargo test 43 passed / 0 failed、--features desktop 48 passed / 0 failed、cargo fmt -- --check、cargo clippy --all-targets -- -D warnings、最终默认 Web cargo build；日志 /home/lilyco/.cache/lycomc-perf/group12/post-fix-check.log。

- bash scripts/runtime-smoke.sh /home/lilyco/.cache/lilyco-build/target/debug/lycomc EXIT=0，返回 {"name":"lycomc","ok":true,"version":"0.1.0","webMode":"embedded"}；修复后 debug 二进制 SHA-256 8a4740ca14fe6b33c30ceda94ba2201a4a0944661e2a7e6cfac3be48874ea342。

- Windows cfg 本机用 Zig GNU wrapper 执行 cargo check --locked --all-targets --target x86_64-pc-windows-gnu EXIT=0、0 warnings（rustc --print cfg 确认 target_family=windows 且无 unix）。本机 MSVC / macOS 交叉检查仅因缺 MSVC SDK / Darwin C toolchain 失败：精确日志为 fatal error: 'stdlib.h' file not found / fatal error: 'string.h' file not found 与 cc: error: unrecognized command-line option '-arch' / -mmacosx-version-min=11.0；远端原生 Runner 才是权威结果。

- 在 slow JAVA_HOME sleep-5 压力下重跑 scripts/compare-binaries.mjs EXIT=0 pass=true、realDataUnchanged=true、隔离服务无残留进程 / 端口；baseline 与修复后 optimized 功能矩阵各 6 项全通过（5 项 settings 语义、9/9 只读端点、SSE、7/7 quickPlay、清理后设置 / running 为空）。性能：/api/state p50 10108.486→1.788 ms（-99.982%，5653.516×）、worst 10192.296→2014.24 ms（-80.238%）、8 并发 20225.63→4.376 ms（-99.978%）；静态 p50 2.285→1.372 ms（-39.956%）、并发吞吐 417.107→492.21 MiB/s（+18.006%）；RSS 31875072→19394560 B。该对比是本机 Linux debug 压力测试，不是 release / 跨平台基准；2014.24 ms 是 2 s 有界 Java 探测。

### 13.3 GitHub Actions 实测结果

- 修复提交 push run 43640971733（headSha f6640ab306c7ca2bdb1380d98f82d46a78fd7556）conclusion=success，3/3 jobs 成功：Web default + optional desktop feature、cargo check x86_64-pc-windows-msvc、cargo check aarch64-apple-darwin。

- 旧的 v0.1.0 对象未发布成功且 gh release view 仍为 release not found，故用 git tag -f -a 将 annotated tag 重指向修复提交，新对象 5c44696eac2cd58428f4d8422b4a268626f2077f、目标 f6640ab306c7ca2bdb1380d98f82d46a78fd7556，以 --force-with-lease=refs/tags/v0.1.0:63cc7082883c72a0df4c374c46102489f45c5c58 推送并由 GitHub API 复核。

- 正式 Release run 43641351214 conclusion=success、7/7 jobs 成功：Linux / Windows MSVC / macOS arm64 compile guard，Linux / Windows MSVC / macOS arm64 release build，publish GitHub Release；gh run view 43641351214 --log-failed 为空。tag CI run 43641351231 conclusion=success。历史失败 run 43635688234 保留为失败记录，不改写为成功。

### 13.4 Release 资产下载、校验和归档复核

- gh release view v0.1.0：isDraft=false、isPrerelease=false、name=LilyCraft Web v0.1.0、publishedAt=2026-11-14T21:17:07Z、URL https://github.com/lilyco-42/lycomc/releases/tag/v0.1.0，共 6 个资产。

- 三平台包下载到 /home/lilyco/.cache/lycomc-perf/release-v0.1.0/ 后 3/3 SHA-256 校验和文件均匹配；归档内含 README.md 与可执行程序：Linux lycomc 13389600 B、macOS lycomc 11215184 B、Windows lycomc.exe 10628608 B。

- Linux Release 包额外解包执行：二进制 SHA-256 5c348a188063e5132f511a98a15dd8bbabbb40564653f951aa22056676938dd7，--schema EXIT=0，bash scripts/runtime-smoke.sh EXIT=0，确认发布产物不只是可下载而且真实启动 Web 服务。

- 完整资产清单：

- lycomc-v0.1.0-aarch64-apple-darwin.tar.gz — 4260609 B，SHA-256 b63cf47a332989ba0f8b72de0815217601ae5716fa158b77d1f458da51d44919；校验和文件复核通过。
- lycomc-v0.1.0-aarch64-apple-darwin.tar.gz.sha256 — 108 B，SHA-256 27547a3824ac2e51f9f056f9ac195329ca22920f592ebbc7addaa4b3397adf6e；本次下载校验对象。
- lycomc-v0.1.0-x86_64-pc-windows-msvc.zip — 4134288 B，SHA-256 43d63b47dec3573dc7c44d84a10aeb5bc12e751750892d8e00003d0c489e252d；校验和文件复核通过。
- lycomc-v0.1.0-x86_64-pc-windows-msvc.zip.sha256 — 107 B，SHA-256 35e18a2eb6a03a94bc57adadce643ccad4fad1347c9a6c9b0c23e0b0942f4344；本次下载校验对象。
- lycomc-v0.1.0-x86_64-unknown-linux-gnu.tar.gz — 4837606 B，SHA-256 f81085cc6cf4d14cfb3d567795d34531185001afc494059e50a0f1a077a61818；校验和文件复核通过。
- lycomc-v0.1.0-x86_64-unknown-linux-gnu.tar.gz.sha256 — 112 B，SHA-256 9fe389a539243c1c2ebc014ab79977e58fa0a7e417658ffd732d7a72cb2bab0e；本次下载校验对象。

- 第 12 组证据含 GitHub run / Release / tag 的 API 快照、下载校验 JSON、修复后本机门禁日志、Windows GNU cfg 检查日志、6 个发布资产及固定提交源文件；清单 /home/lilyco/.cache/lycomc-perf/evidence-group12-manifest.json 本身作为第 39 项登记，前 11 组逐字节保留。

### 13.5 发布完成后的明确边界

- 已证明的是 GitHub Runner 编译、3 个 Release 包、SHA-256、Linux Release 包本机启动；未在 Windows / macOS / Android / 鸿蒙真机运行，未产出签名安装包，不宣称公网正版多人服务器联机或全平台实机演示。

- 本机 debug 性能数据、§11 真实本机 1.20.1 离线服务端联机证据与本节三平台发布证据是三种不同口径，不能相互替代。

- 本节是发布后补证，提交在 main 上；v0.1.0 tag 仍锁定发布时的 f6640ab306c7ca2bdb1380d98f82d46a78fd7556，未为追加文档改动 Release 二进制。

- Android 形态、Win/mac 是否必须签名安装包、快捷方式口径（m04829 / m04836）以及 m03957 的全平台 / 公网正版联机 / 实机演示范围仍待用户重新界定；可选桌面壳输入 P0 按 m06445 保持冻结。

## 14. 发布后加深验证与 v0.1.1 补丁准备（2026-11-15，m07969 / m08285「继续」）

### 14.1 触发与范围

- v0.1.0 发布（§13）后，用户以「继续」驱动对发布物做加深验证，不引入新功能；目标是发现并修复 CLI 命令表顺序非确定性、补回归门禁、准备递增补丁版本。
- 范围只改变 lilyco 依赖 rev 与 lycomc 自身版本号，不重写 v0.1.0 历史；v0.1.0 tag 继续锁定 f6640ab306c7ca2bdb1380d98f82d46a78fd7556。

### 14.2 缺陷定位：CLI --help / --schema 顺序随机

- 根因在 lilyco-core：Registry.commands 与 aliases 原为 HashMap（lilyco-registry-before.rs:12,152,153,160,161），iter() / to_json() 按迭代顺序输出，顺序由每进程随机种子决定。
- 实测：同一 Linux Release 二进制（origin/main 1fc383e HashMap）连跑 6 次 --help 得 6 种顺序、--schema 6 种；已发布 Windows v0.1.0 exe 在 Wine 下 6 次 schema 也 6/6 distinct（wine-schema-orders-published-v0.1.0.json）。
- 这种非确定性会传染到 MCP tools/list、TUI / Web 选择页；任何逐字节 schema 黄金文件都会假失败，因此改为语义排序校验（见 14.4）。

### 14.3 上游修复与本地收口

- 在 lilyco-42/lilyco 开 PR #48（分支 fix/deterministic-registry-order，基于 origin/main 1fc383e），将 commands / aliases 改为 BTreeMap（lilyco-registry-after.rs:12,157,158,165,166，含中文注释说明命令表是对外可观测契约），新增测试 names_are_sorted_regardless_of_registration_order 与 to_json_is_byte_stable_across_registration_orders。
- 提交 d05626dc414e286c11f0f81b426a1026c9dffc81，lilyco-core 单测 68 passed、框架全量 218 passed、fmt 通过；registry.rs 0 clippy 告警（既有 4 个 clippy 报错均在 error.rs / safety.rs / lib.rs，不在改动文件）。
- PR #48 合并：mergeCommit 322fb9ceaee50c3ecf6593b73e0114159422ee90，mergedAt 2026-11-15T07:05:46Z；main CI run 43688393453 与 Vision run 43688392821 均 success（跨仓库 gh run view 43688393453 --repo lilyco-42/lilyco 复核）。
- lycomc 侧：Cargo.toml 将 lilyco 依赖锁到 rev d05626dc414e286c11f0f81b426a1026c9dffc81；src/commands.rs 末尾新增 #[cfg(test)] mod tests，registry_command_names_are_deterministic 断言 14 命令按名有序、len=14、first=account-add、last=settings-set、两次 to_json() 字节相等。

### 14.4 语义等价证明与门禁

- 三份 --schema（v0.1.0 Linux / v0.1.0 Windows(Wine) / 修复后 lycomc）原始各 9093 B，按 name 升序排序后 canonical 5415 B、canonicalSha256 7f196335faeb84de07d45ce73768f7dd55cfe2ac04cf5c725dbb77d841afd329、commandCount=14、allCanonicalEqual=true（canonical-schema-equality.json）。结论：BTreeMap 修复只改顺序不改内容，禁用逐字节 schema 黄金文件。
- scripts/check.sh 在最终 cargo build 后新增 6 次连跑 --help / --schema，对每次输出 sha256sum 后 sort -u | wc -l，要求 HELP_DISTINCT==1 且 SCHEMA_DISTINCT==1，否则 exit 1。选择放进 check.sh 是因为 CI 每次 push 都跑该脚本，可阻止上游 Registry 再次退化成 HashMap。
- 最终本地二进制 6 次 --help / --schema 逐字节各 1 种：HELP_SHA=f7533dd325e6c39ba97b3033b8a7c9e140ac0860e702dd9152d54fd1e61ef4a2、SCHEMA_SHA=0dcfeb14bdce9f463abb940d5990cd08db765dd50723df0fd1b54cfe10188a07、schema 9093 B；bash scripts/runtime-smoke.sh EXIT=0 且 version 已是 0.1.1。

### 14.5 发布物结构加深验证（Wine / PE / Mach-O / 签名边界）

- 在 Wine（wine-11.22）下实跑已发布 Windows v0.1.0 exe：隔离数据目录 + LYCOMC_NO_OPEN=1 启动，/api/health 200、webMode=embedded、版本 0.1.0；GET /api/settings 200、PUT /api/settings 200 落盘、POST /api/settings 405（证明 .get/.put 语义）、POST /api/accounts 生成离线 uuid、GET /api/events 为 text/event-stream、未知 / 缺失进程路由 404；数据目录自动建 accounts/settings/web.port/assets/cache/java/libraries/logs/versions。Wine 可证 Windows 包实跑但不能替代真机。
- PE 证据（pe-readobj / pe-sections / pe-strings-taskkill）：PE32+ console x86-64，IMAGE_FILE_MACHINE_AMD64 0x8664，5 sections，linker 14.51，IMAGE_SUBSYSTEM_WINDOWS_CUI 0x3，DYNAMIC_BASE/HIGH_ENTROPY_VA/NX_COMPAT/TERMINAL_SERVER_AWARE；CertificateTableRVA 0x0 → 未 Authenticode 签名；strings 命中 System32 下的 taskkill.exe 与 /PID /T /F 参数，证明 Windows taskkill 分支已编进包；libc.so 计数 0。
- Mach-O 证据（macho-private-headers / macho-dyld）：MH_MAGIC_64 ARM64 EXECUTE，PIE，LC_BUILD_VERSION platform macos sdk 15.5 minos 11.0；1 条 LC_CODE_SIGNATURE datasize 87072（链接期 ad-hoc，未 Developer ID 签名、未公证）；dyld 链接 /usr/lib 下的 liblzma.5 / libbz2.1.0 / libiconv.2 / libSystem.B。
- 签名边界（signature-boundary.json）：三平台 Runner 包可下载且 SHA-256 可核，Linux 包本机与 Wine 下 Windows 包实跑；Windows / macOS 真机运行、签名安装包、公证均未覆盖。
- 本机缺 x86_64-w64-mingw32-gcc，直接 cargo check --target x86_64-pc-windows-gnu 失败（ToolNotFound）；用 Zig 0.17.1 包装脚本过滤 cc-rs 的 --target= 参数后 zig cc -target x86_64-windows-gnu 可 EXIT=0 0 warnings（windows-gnu-check-zig-v0.1.1.log）。本机交叉检查不替代远端 Runner。

### 14.6 最小锁差异与发布前凭据扫描

- Cargo.lock 从 git show HEAD 还原后仅把 6 处 lilyco 系列 source rev 由 1fc383e 改为 d05626d、lycomc 版本 0.1.0→0.1.1；刻意撤销 cargo update 连带的 windows-sys 0.61.2→0.52.0 等无关重锁，避免补丁引入与顺序修复无关的 Windows 依赖变动。diff 7 insertions / 7 deletions，cargo build --locked --offline EXIT=0。
- 凭据扫描（scan_worktree.py / secret-scan-worktree.json，覆盖 github_token / openai_key / aws_key / private_key / bearer / json_credential / microsoft_device / xauth_cookie）对 v0.1.1 code diff 命中 0；提交后须重扫 staged 与 history（含新 docs），且不得打印 token。

### 14.7 边界与未决项（延续 §13.5）

- 已证明：GitHub Runner 编译、三平台包、校验和、Linux 包本机、Wine 下 Windows 包实跑、CLI 顺序确定性门禁、上游 PR 合并与 main CI 成功。
- 未覆盖：Windows / macOS / Android / 鸿蒙真机、签名安装包、公证、公网正版多人服务器联机、全平台实机演示。
- 未决项不变：m03957 全平台形态 / 公网正版联机 / 实机演示，m04829 / m04836 的 Android 形态 / Win-mac 签名包要求 / 快捷方式口径；桌面输入 P0 仍按 m06445 冻结。

## 15. v0.1.1 远端发布完成、资产校验与发布包确定性复证（2026-11-15，m07969 / m08285「继续」收口）

本节在已发布的 v0.1.1 之后纯追加；v0.1.1 tag 与 Release 二进制不因本节改动，不重写 v0.1.0，也不增发 v0.1.2。全部远端结论以 live GitHub Actions / Release API 为准，证据见第 15 组。

### 15.1 提交、tag 与远端 workflow

- main 提交 5070cc106df15fe5cafe00a5d36d7fd8d2f86f79（`fix(release): 锁定 lilyco BTreeMap 顺序修复并准备 v0.1.1 补丁发布`）已 push，push CI 43693010304 3/3 success；tag push CI 43693353015 3/3 success；Release workflow 43693353082 7/7 success（3 个 compile guard、3 个平台 build/runtime-smoke/打包、1 个 publish）。三次已完成运行的 `--log-failed` 均为空。
- v0.1.1 是 annotated tag：远端 tag object 1aa2543bfd7232895f8288098dca89385951fc8b，peeled commit 5070cc106df15fe5cafe00a5d36d7fd8d2f86f79；v0.1.0 仍指 f6640ab306c7ca2bdb1380d98f82d46a78fd7556，未 force。
- Release https://github.com/lilyco-42/lycomc/releases/tag/v0.1.1 于 2026-11-15T08:17:29Z 发布，name=LilyCraft Web v0.1.1，isDraft=false、isPrerelease=false；6 项资产（3 个平台包 + 3 个 .sha256）全部 state=uploaded。

### 15.2 三平台资产下载与校验

- Linux lycomc-v0.1.1-x86_64-unknown-linux-gnu.tar.gz 4,839,968 B，SHA-256 4fc277b2fb2fd7c4f9afda4216fd01eecc2e67928bf0de25f9f80f0ff4a9aa96。
- Windows lycomc-v0.1.1-x86_64-pc-windows-msvc.zip 4,148,858 B，SHA-256 c269ad14836d32665362476c4edefebc76de8d498e4eb22e3690783139af924e。
- macOS lycomc-v0.1.1-aarch64-apple-darwin.tar.gz 4,259,285 B，SHA-256 fe23ed1091758a62e9c1d12bcf665893c7b4c31c7a4994368e038c7a6bb1c73d。
- `gh release download` 取回 6 项资产；3 份 `.sha256` 经 `sha256sum -c` 全部 OK，且本地文件 SHA-256 与 GitHub asset digest、asset size 三项逐项一致（3/3）。

### 15.3 Linux 发布包与 Wine 下 Windows 发布包复证

- Linux Release 二进制连续 6 次 `--schema` 只有 1 种原始输出，SHA-256 0dcfeb14bdce9f463abb940d5990cd08db765dd50723df0fd1b54cfe10188a07，9,093 B；连续 6 次 `--help` 只有 1 种输出，SHA-256 f7533dd325e6c39ba97b3033b8a7c9e140ac0860e702dd9152d54fd1e61ef4a2；`scripts/runtime-smoke.sh` EXIT=0，/api/health version=0.1.1、webMode=embedded。
- Windows Release 包在本机 Wine 11.22 下连续 6 次 `--schema` 只有 1 种原始输出，且与 Linux Release 的原始 `--schema` 逐字节相同；连续 6 次 `--help` 也只有 1 种输出。Wine 仅用于证明该 Windows 可执行文件可运行与输出确定性，不等同 Windows 真机。
- 两份发布包 schema 均含 14 条命令，按 name 排序后的紧凑 JSON canonical SHA-256 7f196335faeb84de07d45ce73768f7dd55cfe2ac04cf5c725dbb77d841afd329，与修复后本地二进制及 v0.1.0 Linux/Wine schema 的语义内容一致；固定顺序 account-add, accounts, info, install, javas, launch, list, mod-add, mod-remove, mod-search, mods, remove, settings, settings-set。

### 15.4 跨平台 --help 的 argv[0] 差异

- Linux `--help` SHA-256 f7533dd…；Wine 下 Windows `--help` SHA-256 7f09594c161812fb053c3db026f3612914883a5cf90a46adcee1f5a70327a402；原始字节不同仅因 clap Usage 行使用 argv[0]：`Usage: lycomc ...` 对比 `Usage: lycomc.exe ...`。
- 两者 CRLF 计数均为 0、行数均 23；除第 0 行 Usage 外其余 22 行（含完整命令列表与顺序）逐行一致。结论：跨平台可要求各自输出稳定、命令列表一致、schema 原始字节一致，不应要求 `--help` 原始字节跨平台一致。证据 argv0-help-diff.json。

### 15.5 边界与未决项

- 已证明：GitHub Runner 三平台编译/打包与 Release 发布、CI 3/3 与 Release 7/7、三平台包及校验和 3/3、Linux 发布包本机启动、Wine 下 Windows 发布包命令与 schema 确定性、tag 未 force。
- 未覆盖：Windows / macOS / Android / 鸿蒙真机运行、Authenticode / Developer ID 签名安装包、公证、公网正版多人服务器联机、全平台实机演示。第 13 组 PE / Mach-O 签名边界结论仍适用于未签名发布形态。
- 未决项不变：m03957 全平台形态 / 公网正版联机 / 实机演示，m04829 / m04836 的 Android 形态 / Win-mac 签名包要求 / 快捷方式口径；桌面输入 P0 按 m06445 冻结。

## 16. 发布包充分性测试矩阵、可复用回归 runner 与 CI 门禁（2026-11-15，m08499 / m08502 / m08504「继续」）

> 本节是 v0.1.1 发布之后的测试充分性收口：不重写历史、不新增 tag、不改动已发布的 Release 二进制。新增的是判据矩阵、可复用脚本、CI 门禁与第 16 组证据；main HEAD 将晚于 v0.1.1 tag target，二者不可混为一谈。

### 16.1 分层判据矩阵

| 层级 | 通过条件 | 当前实证 | 证据 | 边界 |
|---|---|---|---|---|
| L0 源码静态 | fmt / clippy `-D warnings` / 前端 lint+build / YAML、bash、JSON 语法 | scripts/check.sh EXIT=0；pnpm build 2600 modules；YAML_OK、bash -n、JSON_OK | check-sufficiency.log、ci.yml | 本地静态检查不替代 gh run |
| L1 单元测试 | 默认 + `--features desktop` 全绿，关键不变量有回归测试 | 44 passed / 49 passed；Registry 确定性单测 | check-sufficiency.log | 单测不等价真实浏览器或真机 |
| L2 本地运行时 | 默认 Web 二进制启动、`/api/health`、runtime smoke、清理 | EXIT=0，version=0.1.1、webMode=embedded | runtime-smoke-sufficiency.log | 不替代发布包运行 |
| L3 Web API 契约 | 正向 200、405、坏 JSON 4xx、非法用户名 4xx、未知接口 404、SSE/静态 MIME、路径穿越不泄露 | 发布包 runner 15/15；debug CI 等价 runner 15/15 | runner-output.json、ci-parity-output.json、api-contract-cases.json | 账号 token 永不入证据 |
| L4 并发与长稳 | 16 并发全 2xx；30s 周期 health/state 全 2xx；RSS 有记录、无残留进程 | 发布包 16/16、7.966ms，10 采样全 2xx，RSS -36,864 B；debug CI 等价 16/16、5.987ms，RSS +8,192 B | runner-output.json、ci-parity-output.json | 30s 不是 soak test |
| L5 状态恢复 | 重启后设置从数据目录恢复 | quickPlayServer 重启后仍在 | sufficiency-results.json | 不覆盖跨版本迁移/凭据恢复 |
| L6 故障注入 | 慢 JAVA 探针由 2s 超时有界；损坏配置不崩溃 | 发布包 worst 2,006.859ms < 2,500ms；debug worst 2,012.6ms；损坏 settings.json 回落默认 | runner-output.json、ci-parity-output.json、service-slow.log、service-bad.log | 不覆盖磁盘满/网络分区/权限损坏 |
| L7 发布包确定性 | Linux/Wine 各 6 次 `--help`/`--schema` 稳定、schema canonical 语义一致 | 各 1/6；canonical SHA 一致 | group13/group15 证据 | Wine 不等于 Windows 真机 |
| L8 远端交付 | CI 3/3、Release 7/7、三平台包 SHA-256 3/3 | v0.1.1 已验证 | group15 证据 | 本次 CI 变更不重发 Release |
| L9 真机与分发 | 各 OS 实机、签名/公证、公网正版联机、Android/鸿蒙形态 | none | 需设备录屏/系统日志/签名回执 | 需用户确认形态与口径 |

### 16.2 可复用 runner 与测试脚本自身缺陷

- `scripts/test-sufficiency.sh` 从 `LYCOMC_BIN` 启动发布包或本地默认二进制，自动分配动态端口，隔离 `OUT/data` 与 `OUT/data-slow`，生成合法唯一离线账号名，覆盖 15 条 API 契约（含非法用户名负向 case）、16 并发、30s 周期采样、RSS、慢 JAVA_HOME 探针与进程组清理；任一断言失败即非 0 退出。
- 发布包实测（Linux v0.1.1 lycomc sha256 292908678d340ba15eecdf8bbf513f8899af342fb7e7786be63c9b2ce03bce06）：EXIT=0、15/15、startup 16.346ms、并发 7.966ms、长稳 10/10、慢 JAVA worst 2,006.859ms、failed=[]。
- debug 二进制 CI 等价实测（sha256 54cd4fdc111d8b6d9d5658b7a496a76642d2b676f54521712b06c3403fee9db6）：EXIT=0、15/15、并发 5.987ms、长稳 10/10、慢 JAVA worst 2,012.6ms、failed=[]。
- 两轮 runner 失败均归类为测试脚本缺陷，不是 v0.1.1 发布包回归：第一轮 header map 大小写不一致与复用旧账号名；第二轮 `SufficiencyMatrix-` + `time_ns()` 账号名超过 `src/settings.rs:218-224 valid_name` 的 3–16 字符限制且含连字符，实际返回 `400 用户名需 3–16 个字符`。修复后统一小写 header、清空隔离数据、使用 `S`+14 位 ASCII 字母数字/下划线随机名，并新增非法用户名负向断言。失败证据 runner-first-failure.json / runner-second-failure-summary.json / runner-failure-diagnosis.json 保留。

### 16.3 CI 与准入规则

- `.github/workflows/ci.yml` 的 `checks` job 在 runtime smoke 后新增「发布包级充分性契约 / 并发 / 长稳 / 慢 JAVA 回归」step，5 分钟超时、`LYCOMC_NO_OPEN=1`，使用 `cargo metadata` 给出的 `TARGET_DIR/debug/lycomc` 执行 `scripts/test-sufficiency.sh`；不使用 `|| true`。`cross-compile` 仍只做 Windows/macOS `cargo check`。
- 代码改动至少 L0–L5；涉及 Java 扫描/超时补 L6；涉及命令注册补 L7；发版补 L8；只改 docs 仍需 L0 + CI；新增平台独立做到 L2 + L8，再按用户口径决定是否进入 L9。Wine 与交叉编译不得替代真机。
- 任何断言必须写通过条件与证据路径；只有 console 结论、无落盘证据的不算完成；失败运行保留，修复以新提交递增，不 force 已公开 tag。

### 16.4 充分性结论与边界

- 对 v0.1.1 的「本机 Web 可执行程序 + 三平台 Runner 交付」范围，L0–L8 已有证据且通过，可以称为该范围内充分测试；本次把 L3–L6 从一次性脚本固化为每次 push/PR 的可复用门禁。
- 若把 m03957 的「全平台 LilyCraft / Android / 鸿蒙 / 签名包 / 公网正版联机 / 全平台实机演示」算入范围，则 L9 未开始，不能称为全平台充分测试。Windows/macOS/Android/鸿蒙真机、Authenticode/Developer ID 签名与公证、公网正版多人服务器、设备录屏仍未覆盖；Wine 11.22 只证明 Windows 包实跑与输出确定性。
- 残留 PID 11125（14:32 启动、父进程 systemd、DISPLAY=:0、监听 127.0.0.1:8767）是用户自己的 lycomc Web 服务，非本轮测试产物，未清理；本轮 detached server 均已进程组清理。

### 16.5 证据 JSON 的纯追加字节验证

- `docs/TEST-EVIDENCE.json` 采用尾部 marker 前插入：保留 HEAD 版本 marker 前的全部字节与尾部 `\n  ]\n}\n` 字节；前 15 组逐组 JSON 语义相等，且每组序列化字节未改。`docs-append-check.json` 记录 marker 位置、前后缀 SHA-256、前组语义与第 16 组文件哈希验证结果。git diff 显示 1 行删除仅为闭合数组行的逗号重排，不是删改历史组内容。

## 17. L9 真机与分发准入准备（待决策确认）

### 17.1 本轮范围

- 延续 m08499「如何做好充分测试」的收口：v0.1.1 的 L0–L8 已在 §16 与 group16 证据中通过，本轮不重跑、不发 tag、不改 Release。
- 新增 `docs/L9-READINESS.md`，把尚未开始的 L9 拆成三个必须先确认的决策项和一张可执行判据矩阵；在用户确认前，L9 状态保持「未开始 / 待决策」。
- 本轮只新增准备文档与第 17 组证据，不擅自假定 Android 形态、签名要求或快捷方式范围。

### 17.2 已证基线（引用，不重述为新增证据）

- 提交 `11a5eaef0d76c87cc64ad8cb065a9574d3d96017`，CI run `43700439030` 3/3 success，充分性 step success，`--log-failed` 为空。
- `scripts/test-sufficiency.sh` 15/15、16/16 并发、30s 长稳、慢 JAVA 最差 2006.859 ms 小于 2500 ms。
- v0.1.1 Release 6 资产 SHA-256 已核对，v0.1.0 / v0.1.1 tag 未动。

### 17.3 待确认的三项与建议默认

- A Android 形态：建议 Phase 1 WebView 壳复用 embedded Web，完整原生 UI 暂不推荐。
- B Windows / macOS 签名与公证：建议把 Authenticode + Developer ID/公证 列为 L9 可分发的必要条件；本地无证书，须配好 CI secrets 后由 Runner 产出。
- C 快捷方式 / 安装器范围：建议最小集合（Windows 快捷方式、macOS .app、Linux .desktop），不自动自启、不改默认浏览器、不捆绑 JRE。

### 17.4 L9 判据（确认后启用）

真机冷启动与 API/设置/长稳、签名与公证验证、安装/升级/卸载不残留、公网正版多人联机、连续无剪辑实机录屏；每项都必须有设备型号/OS 版本、原始日志或截图、资产 SHA-256 与通过条件，证据写入 group17 之后的新组，不改写历史组。

### 17.5 证据纯追加

- `docs/TEST-EVIDENCE.json` 从 HEAD 版本 16 组纯追加到 17 组：保留尾部 marker 前全部历史字节与尾部 marker，前 16 组 JSON 语义与逐组序列化字节不变。
- `evidence-group17-manifest.json` 登记新文档、L0–L8 门禁锚点与 group16 manifest 作为证据链根；group17 末项登记 manifest 自身避免循环哈希。

### 17.6 结论

v0.1.1 的 L0–L8 结论不变；L9 在 A/B/C 未确认前不得标记为完成。Wine、交叉编译、Runner 打包均不能替代真机与分发准入证据。

## 18. PCL-CE 100% 功能对标计划与当前差距（Round 1）

- 用户目标更新为「做好测试 和 搞好 对标 pcl -ce 功能100% 实现」。本轮先做事实核验：`docs/PCL-COMPARISON.md` 已有 41 项对比，历史基线为 ✅9 / 🟡16 / ❌14 / ➖2；该基线来自 PCL 原版而非 PCL-CE 精确版本。
- 新增 `docs/PCL-CE-100-PLAN.md`，给出 100% 验收口径、14 项未覆盖与 16 项部分覆盖清单、P0–P5 依赖分阶段、阻塞前提。本轮不宣称 100% 完成，也不改 tag/Release/旧证据。
- 测试连续性：L0–L8 门禁保持（scripts/check.sh + scripts/test-sufficiency.sh + CI run 43702223841）；L9 仍待 `docs/L9-READINESS.md` 的 A/B/C 决策。
- 证据：第 18 组登记计划文档、历史对比文档、门禁脚本与远端 CI 锚点；前 17 组字节与语义不变。
## 19. PCL-CE 100% 对标首项实现：H35 设置导入导出、备份恢复与缓存清理（Round 2）

- PCL-CE 精确基线已锁定为 `PCL-Community/PCL-CE` Release `v2.15.1` / commit `1a7653127d578efdb2a9388999a3fdc67d9e49d5`；旧 41 项清单继续作为代理基线。本轮实现一个真实缺口 H35，不宣称整体 100%。
- 后端新增 `src/backup.rs` 与 6 条 API（32 条总计）：设置导出/导入、备份创建/列表/恢复、缓存清理。导入做浅合并与 sanitize；备份含设置与非凭据账号快照，Unix 权限 0600，id 白名单拒绝路径穿越；清理只操作 `cache/`。
- 前端新增 `#/backup` 页面与导航，提供导出下载/预览、粘贴/文件上传导入、创建/恢复备份、仅清缓存的二次确认流程；含 loading、空态、错误态与成功提示。
- 分层验证：`scripts/check.sh` EXIT=0（pnpm lint 5 warnings/0 errors、2601 modules、默认 50 passed、desktop 55 passed、fmt/clippy -D warnings、双轨构建、runtime smoke、6 次 --help/--schema 各 1 种）；充分性脚本 24/24，16 并发全 2xx，30s/10 采样全 2xx，慢 JAVA 有界 <2500 ms；desktop feature 二进制同样 24/24。
- 浏览器 CDP 真交互：`#/backup` 页面可见四块能力，真实键盘导入设置 `memoryMb=4321/downloadSource=bmcl`，创建备份、确认恢复、确认仅清缓存均通过；7/7 pass，截图 3 张。
- 结论：H35 的 L1/L3/L4/L5/L6 已有本地证据；整体 100% 仍未达成，其余 13 ❌ + 16 🟡 继续按计划推进。第 19 组登记实现文件、门禁日志、充分性结果、浏览器脚本/结果/截图，前 18 组字节与语义不变。
