# lycomc 充分测试判据矩阵（v0.1.1 之后）

## 1. 目标

「充分测试」不是把所有测试无限堆在一起，而是给每个验收层级定义 **必须证明的断言、可复现证据、以及明确不覆盖的边界**。以下矩阵是后续每次功能改动、补丁发布、跨平台扩展的准入基线。

## 2. 分层准入矩阵

| 层级 | 必测断言 | 当前实证 | 不可缺的证据 | 不覆盖 / 需另立验收 |
|---|---|---|---|---|
| L0 源码静态 | fmt、clippy `-D warnings`、前端 lint/build、YAML/bash/JSON 语法 | scripts/check.sh + pnpm build + CI | CI job 结论、脚本日志 | 远端工作流是否真触发，必须查 gh run |
| L1 单元测试 | 默认 + `--features desktop` cargo test；关键不变量有回归测试 | 44 / 49 passed；Registry 确定性单测 | check.sh 输出、失败日志为空 | Rust 单测不等价真实浏览器/真机 |
| L2 本地运行时 | 默认 Web 二进制启动、`/api/health`、runtime smoke、进程清理 | EXIT=0，version/webMode 正确 | runtime-smoke 输出、端口与临时目录记录 | 不替代发布包运行 |
| L3 Web API 契约 | 正向 200、错误方法 405、坏 JSON 4xx、非法用户名 4xx、未知接口 404、SSE MIME、静态 MIME、路径穿越不泄露 | 发布包 14/14 基础契约 + 可复用 runner 15/15 | 逐 case 状态/字节/断言 JSON | 账号 token 永不入证据 |
| L4 并发与长稳 | 至少 16 并发全 2xx；30s 周期 health/state 全 2xx；RSS 增长有记录、无 5xx、无残留进程 | 16/16；10 采样；RSS +45,056 B；4/4 进程清理 | concurrency/longRun/stops JSON | 30s 不宣称 soak test；长压测另立时长与阈值 |
| L5 状态恢复 | 进程重启后设置从数据目录恢复 | `quickPlayServer` 重启后仍在 | 重启前后 `/api/settings` | 不覆盖跨版本迁移/账户凭据恢复 |
| L6 故障注入 | 慢 JAVA 探针 2s 有界；损坏配置服务不崩溃并记录行为 | ad-hoc worst 2,006ms；可复用 runner 也覆盖慢 JAVA 并强制 <2500ms；损坏 settings.json 回落到默认值 | JAVA_HOME wrapper、慢探针日志、损坏配置响应、runner slowJava 摘要 | 不覆盖磁盘满、网络分区、权限损坏、恶意大文件 |
| L7 发布包确定性 | Linux/Wine Windows 各 6 次 `--help`/`--schema` 稳定；schema canonical 语义一致；`--help` 允许 argv[0] 差异 | 各 1/6，canonical SHA 一致 | determinism.json、argv0-help-diff.json | Wine 不等于 Windows 真机 |
| L8 远端交付 | CI 3/3、Release 7/7、三平台包与 SHA-256 3/3 | v0.1.1 已验证 | gh run / gh release / asset digest | 本地 YAML 检查不等于 Runner 成功 |
| L9 真机与分发 | 各目标 OS 实机启动、安装/签名/公证、公网正版多人服务器、鸿蒙/Android 形态 | 当前 none | 设备录屏、系统日志、签名/公证回执 | 必须用户先确认形态与验收口径 |

## 3. 每次改动的准入规则

1. 代码改动：至少 L0–L5；涉及 Java 扫描/超时/进程时补 L6；涉及命令注册时补 L7；发版时补 L8。
2. 只改 docs：L0 与 CI 必须过；若改了测试判据，补对应层级的当前实证，不重写历史 Release。
3. 新增平台：该平台必须独立做到 L2 + L8，再按用户口径决定是否进入 L9；不得用 Wine/交叉编译代替真机。
4. 任何断言必须写「通过条件」和「证据路径」；只有 console 结论、无落盘证据的不算完成。发布包级 L3–L6 可复现入口为 `scripts/test-sufficiency.sh`：隔离数据目录、动态端口、合法唯一账号名、非法用户名负向断言、逐 case 状态/字节断言、16 并发、30s 长稳、慢 JAVA_HOME 有界探针、进程组清理，失败即非 0 退出。
5. 失败运行要保留，不得用 `|| true` 掩盖；修复后以新 tag/新提交递增，不 force 已公开 tag。

## 4. 当前充分性结论

对 v0.1.1 的「本机 Web 可执行程序 + 三平台 Runner 交付」范围，L0–L8 已有证据且通过；这可以称为该范围内充分。若把用户更早提出的「全平台 LilyCraft / Android / 鸿蒙 / 签名包 / 公网正版联机 / 全平台实机演示」也算入范围，则 L9 未开始，不能称为全平台充分测试。

## 5. 已知边界

- Wine 11.22 实跑 Windows 包只能证明可执行与输出确定性，不证明 Windows 真机。
- macOS arm64 只证明 Runner 编译、打包、校验和，不在 Apple 真机启动。
- Android / 鸿蒙无真机包验收；签名与公证未做。
- 公网正版多人服务器、设备录屏/系统日志未纳入当前证据组。
- 损坏配置测试记录为：服务可启动，`GET /api/settings` 回落默认值；这是行为观测，不等于声明所有损坏输入都安全。
- 账号名由 `valid_name` 约束为 3–16 个 ASCII 字母数字/下划线字符；早期 runner 使用超长且含连字符的名字得到 400，已归类为测试脚本缺陷并新增负向契约 case，不把它写成发布包回归。

## 6. CI 落地（2026-11-15）

- `.github/workflows/ci.yml` 的 `checks` job 在 runtime smoke 后执行 `scripts/test-sufficiency.sh`，使用默认 Web debug 二进制、动态端口、隔离数据目录，5 分钟超时；把 L3–L6 纳入每次 push / PR 的强制门禁。
- `cross-compile` job 仍只做 Windows / macOS `cargo check`，不执行运行时契约；发布包级 L7 / L8 由既有 v0.1.1 证据与 Release workflow 覆盖，不因本次 CI 变更重发 Release。
- 失败时脚本非 0 退出，CI 不使用 `|| true`；失败运行保留，修复以新提交递增。
