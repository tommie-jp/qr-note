# shellcheck shell=bash
# do*.sh 共通: バックアップ (ダンプ・bundle) の中身の検査と世代の上限
# (docs/93-リファクタリング計画.md §7-2)。log.sh の die を使うので、先に log.sh を source すること。
#
# **空のバックアップを「ある」ことにしない**のが要点。ssh が失敗してもリダイレクトで
# 0 バイトのファイルが残り、「バックアップがある」ように見えてしまう。
# 巻き戻しの唯一の手段なので、空なら失敗として扱う。

# require_nonempty [--remove] <ファイル> <空のときのメッセージ>
# --remove を付けると、空のファイルを消してから落ちる (残すと次に見た人が「ある」と誤解する)
require_nonempty() {
  local remove=0
  if [ "$1" = "--remove" ]; then
    remove=1
    shift
  fi
  [ -s "$1" ] && return 0
  if [ "$remove" = 1 ]; then
    rm -f "$1"
  fi
  die "$2"
}

# require_keep_count <値>
# 世代の上限 (DUMP_KEEP) の検査。0 を許すと、いま取ったばかりの 1 本まで消える。
# ssh の前に弾くこと
require_keep_count() {
  if [ -n "$1" ] && ! [[ "$1" =~ ^[1-9][0-9]*$ ]]; then
    die "DUMP_KEEP は 1 以上の整数で指定すること (現在: $1)"
  fi
}

# prune_generations <残す本数> <名前の前半> <名前の後半 (拡張子)>
# 「前半 + YYYYMMDD_HHMMSS + 後半」の形の名前だけを数え、新しい順に N 本残して古いものを消す
# (同じ置き場の他の形のファイルには触らない)。消した名前は表示する。
# 時刻は固定幅なので glob の展開順 = 古い順。先頭から「超えた本数」を消す
prune_generations() {
  local keep="$1" prefix="$2" suffix="$3"
  local -a files
  shopt -s nullglob
  files=("$prefix"[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]"$suffix")
  shopt -u nullglob
  local excess=$(( ${#files[@]} - keep ))
  if [ "$excess" -le 0 ]; then
    return 0
  fi
  local old
  for old in "${files[@]:0:excess}"; do
    echo "古い世代を消す: $old"
    rm -f -- "$old"
  done
}
