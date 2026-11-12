# 全 UI 迁移到 PCL.Proto 风格：实现与验收

生成时间：2026-11-13 00:10 +08:00。对应目标：做好视觉 所有 UI 迁移到 PCL.Proto 风格（参考视觉、代码自研，不照搬）。

## 1. 范围与边界
- 本次完成的是「现有 lycomc Web UI 的视觉迁移」：6 个路由（#/、#/versions、#/download、#/mods、#/settings、#/no-such-page）、全局蓝色顶栏、分组侧栏、页面标题/区块标题、卡片、按钮、输入框、标签页、进度条、滑块、对话框、Toast、空状态、账号与皮肤面板、404 兜底。
- 代码与资源全部自研：继续保留 React 19 + Vite + Tailwind + shadcn 与 Rust 四前端内核；没有克隆 PCL.Proto 的 src/，没有复制 .vue/.css/.svg/.png，没有安装 @amagicpear/pcl-proto-components，没有引入 Tauri/Bun，没有改名以 Plain Craft Launcher (PCL) 开头。
- 仅把公开截图中的布局层级、白底激活胶囊导航、浅蓝分组侧栏、淡蓝渐变主区、白卡片、蓝色小标题与 8 级蓝色数值作为参考；CSS 与 TSX 均为本项目自写。
- 本次不新增 PCL.Proto 展示过的联机大厅、远古版/愚人节版、主题解锁等后端功能；后端真实数据仍是 release / snapshot / all 三种过滤。m03957 提到的 Windows / Android / Linux / 鸿蒙全平台打包、服务器游玩与四平台实机演示仍不属于本次视觉迁移的完成范围。

## 2. 实现摘要
- 全局：web/index.html 默认亮色、标题 LilyCraft 启动器；web/src/main.tsx 默认 ThemeProvider=light；web/src/index.css 重写亮/暗两套蓝系 token（亮色 --background #f7fbff、--primary #2078da、--topbar-from #2078da、--page-from #e1ecfa；暗色 #101827 / #172235），新增 topbar-gradient / page-glow / brand-gradient / card-soft 自研 utility。
- 新增 web/src/components/app-topbar.tsx：蓝色全宽顶栏、胶囊主导航、账号皮肤药丸、主题切换；App.tsx 变为顶栏 + 侧栏 + 受限宽度主内容区；app-sidebar.tsx 改为「游戏 / 启动器 / 社区资源」分组。
- 首页重构：左侧大皮肤头像 + 账号/实例选择 + 白底蓝描边「启动游戏」+「实例选择 / 实例设置」；右侧欢迎卡、启动选项四信息卡、最新正式版/快照卡、Java 环境卡。
- 下载页新增自研「最新版本」双卡与正式版/快照/全部三列卡式过滤；版本页、Mod 页、设置页、404 页与 shadcn 基础组件统一蓝系；theme-toggle 默认亮色，sonner 跟随 resolvedTheme。
- 关键修复：home-page.tsx 顶层 return JSX 后补齐函数闭合括号；全局 114 处旧语义色统一到 PCL 蓝 token；最终残留旧配色扫描为 0。

## 3. 构建与运行验收
- pnpm build：vite v8.3.7 built in 1.06s；生成 web/dist/index.html 526 B、index-DSae8eCO.css 83889 B、index-D5GAFr5g.js 542446 B。
- pnpm lint：0 errors / 4 条既有脚手架 warnings（button.tsx、badge.tsx、tabs.tsx 的 only-export-components；use-version-details.ts 的 exhaustive-deps）。
- cargo test --no-fail-fast：17 passed / 0 failed；cargo build 成功并因 build.rs 的 web/dist 依赖重新嵌入前端，二进制 /home/lilyco/.cache/lilyco-build/target/debug/lycomc 36140104 B。
- 重启 systemd user 服务后：ActiveState=active | MainPID=995547 | ExecMainStatus=0；/api/health：{"dataDir":"/home/lilyco/.local/share/lycomc","name":"lycomc","ok":true,"version":"0.1.0","webMode":"embedded"}；/ 引用 index-D5GAFr5g.js。

## 4. CDP 六页与交互冒烟
- /home/lilyco/.cache/lycomc-cdp/all-pages.mjs（Chromium headless 1440x900）：6 个路由全部 skeletons=0、title=LilyCraft 启动器。首页含欢迎来到 LilyCraft!、启动选项、最新版本 26.3、BMCLAPI 国内镜像；版本页共 3 个实例；下载页已获取 923 个远程版本（正式版 103 / 快照 759 / 全部 923）；Mod 页 20 个结果；设置页 6 GB / Java 17/21；404 页正常兜底。
- API_CALLS 覆盖 /api/state、/api/events、/api/remote/versions、/api/modrinth/search、/api/mods、/api/skin/image、/api/accounts/{Steve,lilyco42}/skin。
- /home/lilyco/.cache/lycomc-cdp/ui-interaction.mjs：初始 htmlDark=false，topbar=linear-gradient(100deg, rgb(32, 120, 218), rgb(22, 98, 182))；切换深色 → htmlDark=true / skeletons=0；切换浅色 → htmlDark=false；打开「微软正版登录」→ dialogs=1，显示设备代码登录、正在获取设备代码…、取消登录，skeletons=0。
- 人工复核截图：亮色首页/设置页、深色设置页均为蓝色顶栏 + 分组侧栏 + 白卡/深蓝卡体系，视觉层级对齐参考窗口，品牌保持 LilyCraft，没有出现 PCL II 产品名。

## 5. 合规与静态扫描
- git diff --check：无输出；git diff --cached --check：无输出。
- 项目源码静态扫描（web/src、web/index.html、web/package.json）：旧配色命中 0；禁止资源/组件/品牌命中 0；可疑重复 class 命中 0。
- 说明：先前一次 walk 宽口径扫描列出 18 个 web/node_modules 下的 .ts/.json/.css/.html 第三方依赖文件；再用 grep 对 node_modules 全部文件复核为 322 个命中。两者均非项目源码，node_modules 由 .gitignore 排除且不入库。
- web/package.json 未出现 @amagicpear、tauri、bun 依赖；web/src 中允许出现的 PCL.Proto 文案仅为自研欢迎卡对视觉参考来源的披露与 docs/DECISION.md 历史决策记录，不构成复制代码或资源。
- 本次提交文件为 35 个已修改前端/HTML 源文件 + 1 个新增 app-topbar.tsx + 本验收文档 + DECISION.md 收尾记录；web/dist 按 .gitignore 不入库，运行时由 cargo build 重新嵌入。

## 6. 证据索引（sha256 前 16 位）
- /home/lilyco/.cache/lycomc-cdp/all-home.png · 263409 B · fb0ffcad44279717
- /home/lilyco/.cache/lycomc-cdp/all-versions.png · 284964 B · ebb9600f44ac4266
- /home/lilyco/.cache/lycomc-cdp/all-download.png · 236625 B · fdbe3debb7b9c268
- /home/lilyco/.cache/lycomc-cdp/all-mods.png · 265029 B · 06c5c822d565a100
- /home/lilyco/.cache/lycomc-cdp/all-settings.png · 215717 B · 7af1cefdc42f1c87
- /home/lilyco/.cache/lycomc-cdp/all-no-such-page.png · 200949 B · 64e3323ad06185d6
- /home/lilyco/.cache/lycomc-cdp/dark-settings.png · 217741 B · 6ae4870a6dd5be6f
- /home/lilyco/.cache/lycomc-cdp/ms-dialog.png · 198369 B · 35d57c5feeb76ca8
- web/dist/index.html · 526 B · e616656715c1c219
- web/dist/assets/index-DSae8eCO.css · 83889 B · ef17193d0c15a887
- web/dist/assets/index-D5GAFr5g.js · 542446 B · 5659bf15769773de

## 7. 结论
- 在「参考视觉、代码自研、不照搬」口径下，现有全部 Web UI 已完成 PCL.Proto 风格迁移并通过构建、单测、运行服务、CDP 六页与交互冒烟验收。
- 结论仅覆盖视觉迁移；不宣称达到 m03957 的「比 PCL 更好」、全平台四端打包、服务器游玩或四平台实机演示。
