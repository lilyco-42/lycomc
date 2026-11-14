#!/usr/bin/env bash
# 打包前的固定动作：先把前端产物建好，再让 cargo 把 web/dist 编进二进制。
# cargo-packager 的 beforePackagingCommand 会调用本脚本（见 packaging/Packager.toml）。
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "需要 pnpm 9+（前端产物必须存在，否则二进制里没有界面）" >&2
  exit 1
fi

# Vite/tsc 在 /tmp 为小型内存盘时会 ENOSPC，允许外部指定构建临时目录。
export TMPDIR="${TMPDIR:-$PWD/.cache/tmp}"
mkdir -p "$TMPDIR"

(cd web && pnpm install --frozen-lockfile && pnpm build)
test -f web/dist/index.html
echo "前端产物就绪：$(ls web/dist/assets | tr '\n' ' ')"
