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
cargo clippy --all-targets -- -D warnings
cargo test

echo "lycomc local checks passed"
