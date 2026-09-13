#!/usr/bin/env bash
#
# 本番 (vps2) の DB のバックアップを取る。ローカルから実行する。
# 出力先: backup/vps2-before-import_<timestamp>.dump
#
# 取り込み (./doImportEnex.sh) は書き込む前にこれと同じダンプを自動で取るので、
# 普段はそちらに任せてよい。これは「いま手で 1 本取っておきたい」ときのもの。
#
# 世代の上限 (任意): DUMP_KEEP=N を付けたときだけ、取り終えたあとに同じ名前の
# ダンプを新しい順に N 本残し、古いものを消す (消した名前は表示する)。
# 付けなければ何も消さない (従来どおり)。backup/ は放っておくと際限なく育つ。
# doImportEnex.sh の取り込み前ダンプも**同じ名前**なので、本数に一緒に入る。
#   DUMP_KEEP=10 ./doDumpDB-from-vps2.sh
#
# 戻すとき (本番へ):
#   cat backup/vps2-before-import_<timestamp>.dump |
#     ssh vps2 "cd 41-QR-search/qr-search &&
#       docker compose exec -T db pg_restore --clean --if-exists --no-owner -U qr -d qr"
#
# set -euo pipefail と中身の検査が要点。**これが無いと ssh が失敗しても
# リダイレクトで 0 バイトのファイルが残り、「バックアップがある」ように
# 見えてしまう**。巻き戻しの唯一の手段なので、空なら失敗として扱う。
set -euo pipefail
cd "$(dirname "$0")"

REMOTE="${DUMP_REMOTE:-vps2}"
REMOTE_DIR="${DUMP_REMOTE_DIR:-41-QR-search/qr-search}"
OUT="backup/vps2-before-import_$(date +%Y%m%d_%H%M%S).dump"
KEEP="${DUMP_KEEP:-}"

# 0 を許すと、いま取ったばかりの 1 本まで消える。ssh の前に弾く
if [ -n "$KEEP" ] && ! [[ "$KEEP" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: DUMP_KEEP は 1 以上の整数で指定すること (現在: $KEEP)" >&2
  exit 1
fi

# OUT と同じ形の名前だけを数える (qr-local-backup_* など他のダンプには触らない)。
# 時刻は固定幅なので glob の展開順 = 古い順。先頭から「超えた本数」を消す
prune_old_dumps() {
  local keep="$1"
  local -a dumps
  shopt -s nullglob
  dumps=(backup/vps2-before-import_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9].dump)
  shopt -u nullglob
  local excess=$(( ${#dumps[@]} - keep ))
  if [ "$excess" -le 0 ]; then
    return 0
  fi
  local old
  for old in "${dumps[@]:0:excess}"; do
    echo "古い世代を消す: $old"
    rm -f -- "$old"
  done
}

mkdir -p backup
ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose exec -T db pg_dump -U qr -d qr -Fc" > "$OUT"

if [ ! -s "$OUT" ]; then
  rm -f "$OUT"
  echo "ERROR: ダンプが空。$REMOTE の db が起動しているか確認すること" >&2
  exit 1
fi

du -h "$OUT"

if [ -n "$KEEP" ]; then
  prune_old_dumps "$KEEP"
fi
