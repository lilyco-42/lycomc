#!/usr/bin/env bash
# 本机 Web 可执行程序的最小开箱 smoke：默认二进制 + 临时数据目录 + /api/health。
# 不打开浏览器、不碰真实账号与版本；服务端口从临时 web.port 读回。
set -euo pipefail
cd "$(dirname "$0")/.."

command -v curl >/dev/null 2>&1 || { echo "需要 curl" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "需要 python3" >&2; exit 1; }

cargo build
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
BIN="$TARGET_DIR/debug/lycomc"
[ -x "$BIN" ] || { echo "找不到默认 Web 二进制：$BIN" >&2; exit 1; }

TMP="$(mktemp -d)"
PID=""
cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

PORT="${LYCOMC_PORT:-9410}"
LYCOMC_PORT="$PORT" LYCOMC_NO_OPEN=1 LYCOMC_DATA_DIR="$TMP" "$BIN" >"$TMP/server.log" 2>&1 &
PID=$!

for _ in $(seq 1 40); do
  ACTUAL="$(cat "$TMP/web.port" 2>/dev/null || true)"
  if [ -n "$ACTUAL" ]; then
    if HEALTH="$(curl -fsS --max-time 1 "http://127.0.0.1:$ACTUAL/api/health" 2>/dev/null)" && printf '%s' "$HEALTH" | grep -q '"name":"lycomc"'; then
      printf 'lycomc Web smoke OK: %s\n' "$HEALTH"
      exit 0
    fi
  fi
  sleep 0.25
done

echo "lycomc Web smoke 失败，服务日志：" >&2
cat "$TMP/server.log" >&2
exit 1
