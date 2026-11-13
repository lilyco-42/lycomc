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
