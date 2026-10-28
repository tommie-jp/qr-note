#!/usr/bin/env bash
# 本番の計測行 (docs/119) を取得鍵で読む (docs/120-計測テスト自動化計画.md §3)。
#
# 鍵は /logs?perf=1 の「取得鍵を発行」で出したものを
# ~/.config/qr-note/perf-token に置く (chmod 600)。ログインも ssh も使わない。
# 出力は /logs?perf=1 の「コピー」と同じ形 (新しい順、1 行 1 計測)。
#
# 使い方:
#   scripts/fetchPerfLog.sh                 # 標準出力へ
#   scripts/fetchPerfLog.sh > perf.txt
#   QR_PERF_URL=http://localhost:3301 scripts/fetchPerfLog.sh   # 手元の計測用
set -euo pipefail

TOKEN_FILE="${QR_PERF_TOKEN_FILE:-$HOME/.config/qr-note/perf-token}"
BASE_URL="${QR_PERF_URL:-https://qr.tommie.jp}"

if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "取得鍵がありません: $TOKEN_FILE" >&2
  echo "/logs?perf=1 の「取得鍵を発行」で出した鍵を保存してください (chmod 600)" >&2
  exit 1
fi

# 鍵はコマンドラインに載せない (ps に出る)。ヘッダを標準入力から渡す
TOKEN="$(tr -d '[:space:]' <"$TOKEN_FILE")"
printf 'Authorization: Bearer %s\n' "$TOKEN" |
  curl -fsS --max-time 30 -H @- "$BASE_URL/api/logs/perf/export"
