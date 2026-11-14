#!/usr/bin/env bash
# lycomc 本地维护检查。
#
# 该仓库的 lilyco 依赖当前是绝对路径（../lilyco/lilyco），因此不提供公共 CI：
# 在普通 GitHub Runner 上无法解析该路径。这里只保证本机开发闭环。
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "需要 pnpm 9+" >&2
  exit 1
fi

(
  cd web
  pnpm install --frozen-lockfile
  pnpm lint
  pnpm build
)

cargo fmt -- --check
# 双轨守卫：默认 Web 构建不编译桌面依赖；显式 feature 构建再验桌面壳与 wry 示例。
cargo clippy --all-targets -- -D warnings
cargo test --no-fail-fast
cargo build
cargo clippy --all-targets --features desktop -- -D warnings
cargo test --features desktop --no-fail-fast
cargo build --features desktop

# 最后恢复默认 Web 二进制：双轨检查不能把 target/debug/lycomc 留在 desktop 形态。
cargo build

echo "lycomc local checks passed (web default + optional desktop feature)"
