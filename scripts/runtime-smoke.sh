#!/usr/bin/env bash
# 跨平台运行时 smoke：启动指定 Web 可执行程序，轮询 /api/health，然后清理进程与临时数据目录。
# 适用于 Linux / macOS / Windows Git Bash；不触碰真实用户数据，不打开浏览器。
set -euo pipefail

BIN="${1:-}"
[ -n "$BIN" ] || { echo "用法: $0 <lycomc 可执行程序>" >&2; exit 2; }
[ -x "$BIN" ] || { echo "找不到可执行程序: $BIN" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "需要 curl" >&2; exit 2; }

TMP="$(mktemp -d)"
PID=""
cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# Windows 原生进程需要 Windows 风格路径；Git Bash 提供 cygpath。
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) DATA_ARG="$(cygpath -w "$TMP")" ;;
  *) DATA_ARG="$TMP" ;;
esac

LYCOMC_PORT="${LYCOMC_PORT:-8767}" LYCOMC_NO_OPEN=1 LYCOMC_DATA_DIR="$DATA_ARG" "$BIN" >"$TMP/server.log" 2>&1 &
PID=$!

for _ in $(seq 1 80); do
  if [ -r "$TMP/web.port" ]; then
    ACTUAL="$(tr -d "\r\n" < "$TMP/web.port" 2>/dev/null || true)"
  else
    ACTUAL=""
  fi
  if [ -n "$ACTUAL" ]; then
    if HEALTH="$(curl -fsS --max-time 1 "http://127.0.0.1:$ACTUAL/api/health" 2>/dev/null)" && printf "%s" "$HEALTH" | grep -q '"name":"lycomc"'; then
      printf "lycomc runtime smoke OK: %s\n" "$HEALTH"
      exit 0
    fi
  fi
  sleep 0.25
done

echo "lycomc runtime smoke 失败，服务日志：" >&2
cat "$TMP/server.log" >&2
exit 1
