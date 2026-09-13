#!/usr/bin/env bash
# Evernote の .enex を取り込む。変換はローカル (WSL) で行う。
#
# なぜローカルなのか: 変換は入力に比例してメモリを食う。実データ (40.2MB) を
# Web の口 (/api/import) へ投げると本番 VPS (RAM 2GB / swap 常用。41-QR-search/docs/09) には
# 重い。イメージをローカルでビルドして送る doDeploy.sh と同じで、
# 「重い処理は手元、成果物だけ本番へ」に揃える。
#
# 既定は vps2 の DB へ SSH トンネル越しに書き込む。トンネルの張り方は
# doDeploy.sh の「6/8 マイグレーション」と同じ (vps2 の Postgres は
# 127.0.0.1 にしか公開されておらず、それを変える必要はない)。
#
# **書き込む前に本番 DB のバックアップを必ず取る**。数百行を本番へ書く操作で、
# 取り消す手段はこのダンプしかない。--skip-backup で省けるが、省くなら
# 直前に自分で取っていること。
#
# 使い方:
#   ./doImportEnex.sh <file.enex...>              # vps2 へ (バックアップ込み)
#   ./doImportEnex.sh <file.enex...> --local      # ローカルの db へ (下見用)
#   ./doImportEnex.sh <file.enex...> --check      # ファイルを読むだけ (DB に触らない)
#   ./doImportEnex.sh <file.enex...> --tag レシピ  # 全ノートにタグを追記
#   ./doImportEnex.sh <file.enex...> --force      # 取り込み済みも入れ直す
#   ./doImportEnex.sh <file.enex...> --no-embed   # 画像検索の索引を作らない
#   ./doImportEnex.sh <file.enex...> --yes        # 確認プロンプトを省く
#   ./doImportEnex.sh <file.enex...> --skip-backup # バックアップを省く (非推奨)
#
# 複数ファイルを一度に渡せる。バックアップは最初に 1 回だけ取り、SSH トンネルも
# 張りっぱなしで使い回す (ファイルごとに 4GB 級のダンプを繰り返さない)。
# #evernote は全ノートに必ず付く (由来の印。要らなければ後で一括削除できる)。
#
# 手順の推奨:
#   1. ./doCopyDBfromVPS2.sh          本番のコピーをローカルに作る (採番も本番と同じ)
#   2. ./doImportEnex.sh f.enex --local   下見。レポートと画面を確認する
#   3. ./doImportEnex.sh f.enex           本番へ (実行中はアプリを触らないこと)
#
# 取り込み中にアプリでノートを新規作成しないこと。nextItemNo() は
# 「空き番号の最小値」を返すだけで番号を予約しない (src/lib/items/read.ts)。
#
# 環境変数で上書き可能 (接続先は scripts/lib/target.sh の prod と同じ既定):
#   DEPLOY_REMOTE      ssh 接続先 (default: vps2)。旧名 IMPORT_REMOTE も受け付ける
#   DEPLOY_REMOTE_DIR  リモートの compose ディレクトリ ($HOME 相対)。旧名 IMPORT_REMOTE_DIR も可
#   IMPORT_TUNNEL_PORT トンネルのローカルポート (default: 15433)
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh
. scripts/lib/dumpGuard.sh

target_alias DEPLOY_REMOTE IMPORT_REMOTE
target_alias DEPLOY_REMOTE_DIR IMPORT_REMOTE_DIR
resolve_target prod
# doDeploy.sh の 15432 とずらす。デプロイ中に取り込みを走らせても
# 「ポートが埋まっている」で止まらないようにするため
TUNNEL_PORT="${IMPORT_TUNNEL_PORT:-15433}"
readonly BACKUP_DIR="backup"

usage() {
  echo "usage: $0 <file.enex...> [--local] [--check] [--tag NAME] [--force] [--no-embed] [--yes] [--skip-backup]" >&2
  exit 1
}

FILES=()
LOCAL=0
SKIP_BACKUP=0
IS_CHECK=0
# CLI (scripts/importEnex.ts) へそのまま渡す引数。--local と --skip-backup は
# ラッパー固有なので混ぜない
PASS_THROUGH=()
while [ $# -gt 0 ]; do
  case "$1" in
    --local) LOCAL=1 ;;
    --skip-backup) SKIP_BACKUP=1 ;;
    --check) IS_CHECK=1; PASS_THROUGH+=("$1") ;;
    --no-embed | --force | --yes) PASS_THROUGH+=("$1") ;;
    --tag)
      # --tag は値を取る。CLI 側と同じ扱いで、次の引数もそのまま渡す
      [ $# -ge 2 ] || die "--tag にはタグ名が要ります (例: --tag レシピ)"
      PASS_THROUGH+=("$1" "$2")
      shift
      ;;
    -*) usage ;;
    *)
      [ -f "$1" ] || die "ファイルが無い: $1"
      FILES+=("$1")
      ;;
  esac
  shift
done
[ ${#FILES[@]} -gt 0 ] || usage

run_import() {
  # --conditions=react-server … src/lib のサーバ専用 module は import 'server-only' を
  # 持ち、この条件で解決しないと import した瞬間に throw する (docs/93 §2-2)
  npx tsx --conditions=react-server scripts/importEnex.ts "${FILES[@]}" ${PASS_THROUGH+"${PASS_THROUGH[@]}"}
}

if [ "$IS_CHECK" = "1" ]; then
  log "下見 (DB には触らない)"
  run_import
  exit 0
fi

if [ "$LOCAL" = "1" ]; then
  log "ローカルの db へ取り込む"
  [ -f .env ] || die ".env がない。cp .env.example .env して値を設定すること"
  local_db pg_isready -U qr -d qr >/dev/null 2>&1 ||
    die "ローカルの db が起動していない。docker compose up -d db を先に実行すること"
  # .env の DATABASE_URL をそのまま使う (dotenv/config が読む)
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
  require_nonempty "$BACKUP" "バックアップが空。中止する (巻き戻せない状態では進めない)"
  du -h "$BACKUP"
  echo "戻すには: docker/psql で pg_restore --clean --if-exists (doCopyDBfromVPS2.sh 冒頭に手順)"
fi

log "2/3 SSH トンネル (localhost:$TUNNEL_PORT → $REMOTE の 127.0.0.1:$REMOTE_DB_PORT)"
# ControlMaster で管理し、終了時に必ず閉じる (doDeploy.sh と同じ)
ssh_master_init import
trap ssh_master_close EXIT

DB_URL="$(remote_db_url "$TUNNEL_PORT" "$REMOTE_DB_NAME")"
ssh_master_open "$TUNNEL_PORT" "$REMOTE_DB_PORT"
echo "OK"

log "3/3 取り込み"
DATABASE_URL="$DB_URL" run_import
