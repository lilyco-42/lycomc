#!/usr/bin/env bash
# lycomc 本地维护检查。
#
# lilyco 依赖已锁到公开 git rev，本机与 GitHub Runner 使用同一套解析方式。
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
