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
#
# 接続先は scripts/lib/target.sh の prod (DEPLOY_REMOTE / DEPLOY_REMOTE_DIR で上書き可)。
# 旧名 DUMP_REMOTE / DUMP_REMOTE_DIR も引き続き受け付ける。
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh
. scripts/lib/dumpGuard.sh

target_alias DEPLOY_REMOTE DUMP_REMOTE
target_alias DEPLOY_REMOTE_DIR DUMP_REMOTE_DIR
resolve_target prod
OUT="backup/vps2-before-import_$(date +%Y%m%d_%H%M%S).dump"
KEEP="${DUMP_KEEP:-}"

# 0 を許すと、いま取ったばかりの 1 本まで消える。ssh の前に弾く
require_keep_count "$KEEP"

mkdir -p backup
remote_db pg_dump -U qr -d qr -Fc > "$OUT"

require_nonempty --remove "$OUT" "ダンプが空。$REMOTE の db が起動しているか確認すること"

du -h "$OUT"

# OUT と同じ形の名前だけを数える (qr-local-backup_* など他のダンプには触らない)
if [ -n "$KEEP" ]; then
  prune_generations "$KEEP" backup/vps2-before-import_ .dump
fi
