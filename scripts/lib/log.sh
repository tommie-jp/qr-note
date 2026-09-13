# shellcheck shell=bash
# do*.sh 共通: ログ出力と区間ごとの計時 (docs/93-リファクタリング計画.md §7-2)。
# 実行はせず source して使う:
#   . scripts/lib/log.sh
#
# 以前は log() / die() が 10 本のスクリプトに逐語で並んでいた。

log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# 区間ごとの所要時間を控え、最後にまとめて出す (docs/80-デプロイ再高速化計画.md §6)。
# 「デプロイが遅い」と感じたときに、どこが遅いのかを推測しないで済ませるため。
# 失敗して落ちたときも (そこまでの分を) 出せるよう、print_timing は EXIT trap から呼ぶ
# 想定にしてある — どこで待たされたかは失敗時こそ知りたい。
#
#   timing_start            計時の起点 (合計もここから数える)
#   step_done "<区間名>"     直前の区切りからここまでを 1 区間として控える
#   print_timing            控えた区間と合計を出す (1 区間も無ければ何も出さない)
timing_start() {
  TIMING_T0="$(date +%s)"
  STEP_T0="$TIMING_T0"
  STEP_NAMES=()
  STEP_SECS=()
}

step_done() {
  local now
  now="$(date +%s)"
  STEP_NAMES+=("$1")
  STEP_SECS+=("$((now - STEP_T0))")
  STEP_T0="$now"
}

# 秒を先に置くのは桁が揃うから。ラベルを %-Ns で揃えると、日本語は 1 文字 3 バイトの
# ため printf のバイト数勘定とずれて列が崩れる
print_timing() {
  [ "${#STEP_NAMES[@]}" -gt 0 ] || return 0
  local i
  echo ""
  echo "==> 処理時間"
  for i in "${!STEP_NAMES[@]}"; do
    printf '    %5ds  %s\n' "${STEP_SECS[$i]}" "${STEP_NAMES[$i]}"
  done
  printf '    %5ds  %s\n' "$(($(date +%s) - TIMING_T0))" "合計"
}
