# L9 真机与分发准入准备（待决策确认）

## 1. 目的

本文把 v0.1.1 已完成的 L0–L8 与尚未开始的 L9 分开，给出 L9 的可执行准入判据与三个必须先确认的决策项。本文不修改 v0.1.0/v0.1.1 tag、Release 二进制或已归档证据。

## 2. 已证范围（L0–L8）

- 提交：11a5eaef0d76c87cc64ad8cb065a9574d3d96017；CI run 43700439030 3/3 success，新增充分性 step success，--log-failed 为空。
- 回归：scripts/test-sufficiency.sh 15/15，16/16 并发 7.966 ms，30s 长稳 10 采样全 2xx，慢 JAVA 最差 2006.859 ms 小于 2500 ms，进程组清理。
- 发布：v0.1.1 Release 6 资产 SHA-256 已核对；Linux 包与 Wine 下 Windows 包各 6 次 --help/--schema 逐字节 1 种。
- 边界：macOS arm64 仅 Runner 编译打包；Wine 不是 Windows 真机；Android/鸿蒙无真机；未签名/未公证；公网正版多人服务器与实机演示未覆盖。

## 3. 三个待确认决策与建议默认

### A. Android 形态

建议默认：Phase 1 采用 WebView 壳，复用当前 embedded Web 与本机 loopback HTTP 服务，不重写原生 UI；目标 Android 10+/arm64。
理由：Web-first 已定，维护面最小；完整原生 UI 与 m06445 冻结的桌面壳同属高成本分支。
L9 验收：真机冷启动、/api/health、设置持久化、离线账号、30s 长稳、退出清理、无 WebView 混合内容阻断；证据为真机截图/录屏 + 日志 + 校验和。
备选：完整原生 UI（暂不推荐，需单独立项）。

### B. Windows / macOS 签名与公证

建议默认：L9 的可分发必须包含 Windows Authenticode 签名与 macOS Developer ID + 公证 staple；当前 zip/tar.gz 均为未签名或链接期 ad-hoc，不能算完成。
理由：未签名包在 SmartScreen/Gatekeeper 会拦截，无法证明真实用户可安装运行。
前置：签名证书与 Apple 开发者账号、CI secrets、签名步骤；本地无凭据，只能在配置完成后由 Runner 产出。
验收：signtool verify / spctl -a -vv 通过，公证 staple 成功，发布资产登记签名状态与 SHA-256。

### C. 快捷方式 / 安装器范围

建议默认：最小范围 = Windows 桌面与开始菜单快捷方式、macOS .app 包放入 Applications、Linux .desktop + 图标；默认 --web 本机浏览器；不自动开机自启、不改默认浏览器、不捆绑 JRE。
理由：与 Web-first 一致，避免安装器权限与捆绑依赖带来新的维护与安全风险。
验收：安装、快捷方式启动 runtime-smoke、卸载无残留、升级不覆盖用户数据目录。

## 4. L9 判据矩阵（确认后启用）

| 项 | 通过条件 | 证据 |
| --- | --- | --- |
| Android 真机 | 冷启动与 API/设置/长稳通过 | 设备型号、Android 版本、录屏、日志 |
| Windows 真机 + 签名 | 安装、启动、签名验证、卸载通过 | signtool 输出、录屏、资产 SHA |
| macOS 真机 + 公证 | Gatekeeper 通过、应用启动、卸载通过 | spctl/stapler 输出、录屏、资产 SHA |
| 安装包/快捷方式 | 安装/升级/卸载不残留、不改用户数据 | 脚本日志与前后目录对比 |
| 公网正版多人联机 | 正版账号登录、加入公开服务器、皮肤与聊天正常 | 服务端/客户端日志与截图，不打印 token |
| 实机演示 | 上述真机流程连续录屏，无剪辑遮盖失败 | 原始视频文件 SHA-256 |

## 5. 当前结论

在 A/B/C 未确认前，L9 保持未开始/待决策；v0.1.1 的 L0–L8 结论不变。确认后按本文矩阵补证据，新增 group17+ 证据组，不改写历史组。

## 6. 决策请求

请确认或修改 A/B/C 三项。若同意建议默认，我按 Phase 1 WebView 壳 + 必须签名公证 + 最小快捷方式范围继续；若要求不同，我按你的选择重排 L9 判据。
