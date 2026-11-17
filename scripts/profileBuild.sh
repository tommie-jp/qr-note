#!/usr/bin/env bash
# ビルド・開発の計測 (docs/127 §5)。
#
#   1. tsc --noEmit と vitest run の所要と最大 RSS (/usr/bin/time -v)
#   2. 作業ツリーから :perf イメージをビルドする所要 (--no-cache は付けない。
#      付けると npm ci の通信まで測ることになり、ぶれが大きい)
#   3. イメージの大きさと、中の .next/static の JS・CSS (生・gzip) の合計と
#      大きい順 15 本
#
# 作業ツリーで next build はしない (ユーザーの dev サーバの .next を壊しうる)。
# 出力は JSON 1 つ。
#
#   ./scripts/profileBuild.sh [出力先.json] [イメージのタグ]
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-perf-baseline/build.json}"
TAG="${2:-qr-search-app:perf}"
mkdir -p "$(dirname "$OUT")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# コマンドを測り、{"sec":…, "maxRssMB":…} を返す
measure() {
  local name="$1"
  shift
  /usr/bin/time -v -o "$tmp/$name.time" "$@" >"$tmp/$name.log" 2>&1 </dev/null || {
    echo "$name が失敗した (ログ: $tmp/$name.log)" >&2
    tail -20 "$tmp/$name.log" >&2
    exit 1
  }
  local wall maxkb
  wall="$(awk -F': ' '/Elapsed \(wall clock\)/ {print $2}' "$tmp/$name.time")"
  maxkb="$(awk -F': ' '/Maximum resident set size/ {print $2}' "$tmp/$name.time")"
  # m:ss.ss または h:mm:ss を秒に
  local sec
  sec="$(awk -F: '{ if (NF == 3) print $1*3600 + $2*60 + $3; else print $1*60 + $2 }' <<<"$wall")"
  jq -n --arg name "$name" --argjson sec "$sec" --argjson maxkb "$maxkb" \
    '{name: $name, sec: $sec, maxRssMB: (($maxkb / 1024) | round)}'
}

{
  measure tsc npx tsc --noEmit
  measure vitest npx vitest run
  measure docker-build docker build -q -t "$TAG" .
} | jq -s '.' >"$tmp/times.json"

image_mb="$(docker image inspect "$TAG" --format '{{.Size}}' | awk '{printf "%d", $1 / 1048576}')"

# イメージの中の静的資産 (standalone の .next/static)
docker run --rm --entrypoint sh "$TAG" -c '
  cd /app/.next/static 2>/dev/null || exit 0
  find . -type f \( -name "*.js" -o -name "*.css" \) | while read -r f; do
    printf "%s\t%s\t%s\n" "$f" "$(wc -c <"$f")" "$(gzip -c "$f" | wc -c)"
  done
' >"$tmp/assets.tsv"

jq -Rn --argjson times "$(cat "$tmp/times.json")" --argjson imageMB "$image_mb" --arg tag "$TAG" '
  [inputs | split("\t") | {file: .[0], bytes: (.[1]|tonumber), gzip: (.[2]|tonumber)}] as $files |
  def sum(f): map(f) | add // 0;
  {
    measuredAt: (now | todate),
    tag: $tag,
    times: $times,
    imageMB: $imageMB,
    static: {
      js: { files: ($files | map(select(.file | endswith(".js"))) | length),
            kb: (($files | map(select(.file | endswith(".js"))) | sum(.bytes)) / 1024 | round),
            gzipKB: (($files | map(select(.file | endswith(".js"))) | sum(.gzip)) / 1024 | round) },
      css: { files: ($files | map(select(.file | endswith(".css"))) | length),
             kb: (($files | map(select(.file | endswith(".css"))) | sum(.bytes)) / 1024 | round),
             gzipKB: (($files | map(select(.file | endswith(".css"))) | sum(.gzip)) / 1024 | round) },
      largest: ($files | sort_by(-.bytes) | .[:15] | map({file, kb: (.bytes / 1024 | round), gzipKB: (.gzip / 1024 | round)}))
    }
  }' "$tmp/assets.tsv" >"$OUT"
cat "$OUT"
