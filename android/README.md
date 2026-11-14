# LilyCraft · Android 壳（源码）

一个 Kotlin + WebView 的薄壳，业务逻辑（安装 / 启动 / Mod / 汉化 / 正版登录）全部复用
仓库根目录的 Rust 内核，通过 JNI 调用 `nativeStart()` 在进程内起一个只监听
`127.0.0.1` 的本地服务，然后 WebView 打开它。界面上不出现端口和 IP。

> 工作假设（用户未确认形态时按此推进）：Android 端定位为**本地管理 / 教程 / 远程控制壳**，
> 不是在手机上直接跑 Java 版 Minecraft。若要做手机真玩（Pojav 类运行时），
> 需要另立 NDK + 运行时项目，不属于本壳范围。

## 构建

```bash
# 0) 前置：Android SDK + NDK、Rust target、cargo-ndk
rustup target add aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk

# 1) 前端产物要先构建（会被 include_dir! 编进 .so）
cd web && pnpm install && pnpm build && cd ..

# 2) 编内核（产出 android/app/src/main/jniLibs/<abi>/liblycomc.so）
cargo ndk -t arm64-v8a -t x86_64 -o android/app/src/main/jniLibs build --release --lib

# 3) 打包 APK
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk（未签名，不能直接上架）
```

## 本机是否能出 APK

当前开发机没有 Android SDK 的 NDK 命令行工具与 Gradle（`cargo-ndk`、`gradle` 均未安装），
因此**本仓库不包含已构建的 APK**，也不声称安卓实机已验收。四端里只有 Linux 做过实机验收，
Windows / macOS / Android 交付的是源码 + CI 配置。

## 文件

| 文件 | 作用 |
|---|---|
| `app/src/main/java/app/lilycraft/launcher/MainActivity.kt` | 起内核、开 WebView、处理返回键 |
| `app/src/main/AndroidManifest.xml` | INTERNET 权限、单 Activity、launcher 入口 |
| `app/src/main/res/xml/network_security_config.xml` | 只对 127.0.0.1 / localhost 放开明文 HTTP |
| `app/build.gradle.kts` | abiFilters、jniLibs 目录、构建前检查 liblycomc.so |
