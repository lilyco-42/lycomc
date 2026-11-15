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
# 直接复用 cargo metadata 给出的 target 目录，避免本机共用 build 缓存时找不到二进制。
TARGET_DIR=$(cargo metadata --format-version 1 --no-deps --locked | node -e 'let x = ""; process.stdin.on("data", d => x += d); process.stdin.on("end", () => process.stdout.write(JSON.parse(x).target_directory))')
cargo build

# --help / --schema 是对外契约：同一二进制连续 6 次必须逐字节一致，
# 防止上游 Registry 迭代顺序再次退化成 HashMap 随机种子。
DETERMINISM_TMP=$(mktemp -d)
trap 'rm -rf "$DETERMINISM_TMP"' EXIT
for i in 1 2 3 4 5 6; do
  "$TARGET_DIR/debug/lycomc" --help > "$DETERMINISM_TMP/help-$i.txt"
  "$TARGET_DIR/debug/lycomc" --schema > "$DETERMINISM_TMP/schema-$i.json"
done
HELP_DISTINCT=$(sha256sum "$DETERMINISM_TMP"/help-*.txt | awk '{print $1}' | sort -u | wc -l)
SCHEMA_DISTINCT=$(sha256sum "$DETERMINISM_TMP"/schema-*.json | awk '{print $1}' | sort -u | wc -l)
if [ "$HELP_DISTINCT" != 1 ] || [ "$SCHEMA_DISTINCT" != 1 ]; then
  echo "lycomc CLI --help/--schema 输出在 6 次运行间不一致: help=$HELP_DISTINCT schema=$SCHEMA_DISTINCT" >&2
  exit 1
fi

echo "lycomc local checks passed (web default + optional desktop feature)"
