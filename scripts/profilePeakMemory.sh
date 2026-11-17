#!/usr/bin/env bash
# 重い処理のピークメモリを測る (docs/127 §3)。
#
# 処理ごとに新しいプロセスで scripts/peakMemoryTask.ts を流し、/usr/bin/time -v の
# 「Maximum resident set size」を取る。これは子孫 (TeX の描画プロセス) まで含めた
# 一番大きなプロセスの値。各処理を RUNS 回流して中央値・最小・最大を出す。
#
#   ./scripts/profilePeakMemory.sh [出力先.json] [回数]
#
# 本番では流さない (TeX は 1 本で約 400MB。同居のコンテナを圧迫する)。
# 本番の余裕は、ここの値とベンチ画面の cgroup の平常値から見積もる
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-perf-baseline/peak-memory.json}"
RUNS="${2:-5}"
TASKS=(noop parse thumb tex zip)

mkdir -p "$(dirname "$OUT")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for task in "${TASKS[@]}"; do
  for run in $(seq 1 "$RUNS"); do
    /usr/bin/time -v -o "$tmp/time.txt" \
      npx tsx --conditions=react-server scripts/peakMemoryTask.ts "$task" >"$tmp/out.json" </dev/null
    maxkb="$(awk -F': ' '/Maximum resident set size/ {print $2}' "$tmp/time.txt")"
    wall="$(awk -F': ' '/Elapsed \(wall clock\)/ {print $2}' "$tmp/time.txt")"
    jq -c --arg run "$run" --argjson maxkb "$maxkb" --arg wall "$wall" \
      '. + {run: ($run|tonumber), treeMaxRssMB: (($maxkb / 1024) | round), wall: $wall}' \
      "$tmp/out.json" | tee -a "$tmp/all.jsonl" >&2
  done
done

# 処理ごとに 1 回目 (暖機) を除いた中央値・最小・最大
jq -s '
  def med: sort | if length == 0 then null elif length % 2 == 1 then .[length/2|floor] else (.[length/2-1] + .[length/2]) / 2 end;
  group_by(.task) | map(
    (map(select(.run > 1))) as $rows |
    {
      task: .[0].task,
      scale: .[0].scale,
      runs: ($rows | length),
      treeMaxRssMB: { median: ($rows | map(.treeMaxRssMB) | med), min: ($rows | map(.treeMaxRssMB) | min), max: ($rows | map(.treeMaxRssMB) | max) },
      ms: { median: ($rows | map(.ms) | med), min: ($rows | map(.ms) | min), max: ($rows | map(.ms) | max) }
    })
' "$tmp/all.jsonl" >"$OUT"
cat "$OUT"
