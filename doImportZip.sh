#!/usr/bin/env bash
# QR Note の書き出し形式の ZIP を 1 つ、画面 (/api/import) を通さずに本番へ取り込む (docs/104 §11)。
#
# 最初の用途は教科書 (tommie-circuit-workbook) の取り込み。1 冊を
# scripts/convertWorkbookToZip.mjs で ZIP にし、冊ごとにこれで入れる (docs/104 §4 の決め 7)。
#
# なぜ画面を通さないか: 本番 VPS (RAM 2GB / swap 常用) に数百件の ZIP を投げるより、
# doImportEnex.sh と同じく「重い処理は手元、本番 DB へは SSH トンネル越しに書く」に揃える。
# 本番の compose ディレクトリにはソース (scripts/) が無いので、リモートで tsx は動かない。
#
# **書き込む前に本番 DB のバックアップを必ず取る** (doImportEnex.sh と同じ)。
# --skip-backup で省けるが、省くなら直前に自分で取っていること (./doDumpDB-from-vps2.sh)。
#
# 使い方:
#   ./doImportZip.sh <file.zip>                   # vps2 へ (バックアップ込み、既にある番号は残す)
#   ./doImportZip.sh <file.zip> overwrite         # 既にある番号を ZIP の内容で置き換える (再取り込み)
#   ./doImportZip.sh <file.zip> --local           # ローカルの db へ (下見用。.env の DATABASE_URL)
#   ./doImportZip.sh <file.zip> --skip-backup     # バックアップを省く (非推奨)
#
# 番号の衝突 (2 つ目の引数。既定 skip):
#   skip       既にある番号は残して見送る。同じ ZIP を 2 度入れても重ならない (冪等)
#   overwrite  既にある番号を ZIP の内容で置き換える。教科書を直したあとの再取り込み
#   renumber   空き番号に振り直す。教科書には使わない (題どうしのリンクが /item/<番号> で固定)
#
# 取り込んだあとに回路図 (circuit) を先に描いておくこと:
#   ./doBackfill.sh circuits      最初に開いた人が TeX の描画を待たずに済む
#
# 取り消し (冊ごと): item_no が `wb04-` で始まる行を消す (docs/104 §11)。
# 丸ごと戻すなら backup/ のダンプを pg_restore (doDumpDB-from-vps2.sh 冒頭に手順)。
#
# 取り込み中にアプリでノートを新規作成しないこと (doImportEnex.sh と同じ注意)。
#
# 環境変数で上書き可能 (接続先は scripts/lib/target.sh の prod と同じ既定):
#   DEPLOY_REMOTE      ssh 接続先 (default: vps2)
#   DEPLOY_REMOTE_DIR  リモートの compose ディレクトリ ($HOME 相対)
#   IMPORT_TUNNEL_PORT トンネルのローカルポート (default: 15433。doDeploy.sh の 15432 とずらす)
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh
. scripts/lib/dumpGuard.sh

resolve_target prod
TUNNEL_PORT="${IMPORT_TUNNEL_PORT:-15433}"
readonly BACKUP_DIR="backup"

usage() {
  echo "usage: $0 <file.zip> [skip|overwrite|renumber] [--local] [--skip-backup]" >&2
  echo "       $0 -h    (詳しい説明)" >&2
  exit 1
}

help() {
  sed -n '2,/^set -euo pipefail$/ { /^#/ s/^# \{0,1\}//p }' "$0"
  exit 0
}

ZIP=""
POLICY=""
LOCAL=0
SKIP_BACKUP=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) help ;;
    --local) LOCAL=1 ;;
    --skip-backup) SKIP_BACKUP=1 ;;
    skip|overwrite|renumber)
      [ -z "$POLICY" ] || usage
      POLICY="$arg"
      ;;
    -*) usage ;;
    *)
      [ -z "$ZIP" ] || usage
      [ -f "$arg" ] || die "ファイルが無い: $arg"
      ZIP="$arg"
      ;;
  esac
done
[ -n "$ZIP" ] || usage
POLICY="${POLICY:-skip}"

run_import() {
  # --conditions=react-server … src/lib のサーバ専用 module は import 'server-only' を
  # 持ち、この条件で解決しないと import した瞬間に throw する (docs/93 §2-2)
  npx tsx --conditions=react-server scripts/importZipFile.ts "$ZIP" "$POLICY"
}

if [ "$LOCAL" = "1" ]; then
  log "ローカルの db へ取り込む ($ZIP, $POLICY)"
  [ -f .env ] || die ".env がない。cp .env.example .env して値を設定すること"
  local_db pg_isready -U qr -d qr >/dev/null 2>&1 ||
    die "ローカルの db が起動していない。docker compose up -d db を先に実行すること"
  run_import
  exit 0
fi

# --- ここから本番 (vps2) ---

log "0/3 事前チェック ($REMOTE)"
remote_reachable ||
  die "$REMOTE に ssh 接続できない"
remote_db pg_isready -U qr -d qr >/dev/null 2>&1 ||
  die "$REMOTE の db が起動していない"
echo "OK"

if [ "$SKIP_BACKUP" = "1" ]; then
  echo "警告: バックアップを省いた。取り消す手段が無い状態で本番へ書き込む"
else
  log "1/3 本番 DB のバックアップ"
  mkdir -p "$BACKUP_DIR"
  BACKUP="${BACKUP_DIR}/vps2-before-import_$(date +%Y%m%d_%H%M%S).dump"
  # ssh の失敗でも空ファイルが残り「バックアップがある」ように見えてしまうので、
  # 中身があることまで確かめる。ここが唯一の巻き戻し手段
  remote_db pg_dump -U qr -d qr -Fc > "$BACKUP"
  require_nonempty --remove "$BACKUP" "バックアップが空。中止する (巻き戻せない状態では進めない)"
  du -h "$BACKUP"
fi

log "2/3 SSH トンネル (localhost:$TUNNEL_PORT → $REMOTE の 127.0.0.1:$REMOTE_DB_PORT)"
ssh_master_init import
trap ssh_master_close EXIT

DB_URL="$(remote_db_url "$TUNNEL_PORT" "$REMOTE_DB_NAME")"
ssh_master_open "$TUNNEL_PORT" "$REMOTE_DB_PORT"
echo "OK"

log "3/3 取り込み ($ZIP, $POLICY)"
DATABASE_URL="$DB_URL" run_import
