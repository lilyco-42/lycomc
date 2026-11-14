#!/usr/bin/env bash
# 在本机构建 Android APK 的最短路径（需要 Android SDK + NDK + cargo-ndk + Gradle）。
# CI 上由 .github/workflows/release.yml 的 android job 调用；本机当前不具备这些工具，
# 因此仓库里不含已构建的 APK，也不声称安卓实机已验收。
set -euo pipefail
cd "$(dirname "$0")/.."

command -v cargo-ndk >/dev/null 2>&1 || { echo "缺少 cargo-ndk：cargo install cargo-ndk" >&2; exit 1; }
rustup target list --installed | grep -q aarch64-linux-android || rustup target add aarch64-linux-android x86_64-linux-android

bash scripts/package-front.sh

# cargo-ndk 要求 ANDROID_NDK_HOME（或 NDK_HOME）指向 NDK 根目录。
: "${ANDROID_NDK_HOME:=}" "${NDK_HOME:=}"

cargo ndk -t arm64-v8a -t x86_64 -o android/app/src/main/jniLibs build --release --lib
test -f android/app/src/main/jniLibs/arm64-v8a/liblycomc.so

(cd android && ./gradlew assembleDebug)
ls -l android/app/build/outputs/apk/debug/app-debug.apk
