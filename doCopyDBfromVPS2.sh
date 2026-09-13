#!/usr/bin/env bash
# 本番 (vps2) の DB をローカル (WSL2) へ上書きコピーする。ローカルから実行する。
#
# ローカルの qr データベースを破棄し、vps2 の内容で丸ごと置き換える。
# 画像は Ver2.x で uploads volume から DB (images テーブル) へ移したため、
# このスクリプトだけでメモ・タグ・画像がすべて揃う (volume のコピーは不要)。
#
# 前提:
#   - ローカル / vps2 とも docker compose の db サービスが起動している
#   - 両者の db は同じイメージ (groonga/pgroonga:*-alpine-16) のため、
#     pg_dump / pg_restore のバージョン差を考えなくてよい
#   - DB 操作はコンテナ内の Unix ソケット (trust 認証) 経由で行うので、
#     パスワードも SSH トンネルも要らない (doDeploy.sh のような .env 取得は不要)
#
# 使い方:
#   ./doCopyDBfromVPS2.sh          # 確認プロンプトあり
#   ./doCopyDBfromVPS2.sh --yes    # プロンプトを省略 (自動実行用)
#
# 環境変数で上書き可能 (scripts/lib/target.sh の prod と同じ既定):
#   DEPLOY_REMOTE      ssh 接続先 (default: vps2)。旧名 COPY_REMOTE も受け付ける
#   DEPLOY_REMOTE_DIR  リモートの compose ディレクトリ ($HOME 相対)。旧名 COPY_REMOTE_DIR も可
#
# ロールバック: 上書き前のローカル DB は backup/ に退避する。戻すには
#   docker compose stop app
#   docker compose exec -T db pg_restore --clean --if-exists --no-owner -U qr -d qr \
#     < backup/qr-local-backup_<timestamp>.dump
#   docker compose up -d app
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh
. scripts/lib/health.sh
. scripts/lib/dumpGuard.sh

# local_db / remote_db / query_local / query_remote は scripts/lib/remote.sh
target_alias DEPLOY_REMOTE COPY_REMOTE
target_alias DEPLOY_REMOTE_DIR COPY_REMOTE_DIR
resolve_target prod
readonly BACKUP_DIR="backup"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
readonly LOCAL_BACKUP="${BACKUP_DIR}/qr-local-backup_${TIMESTAMP}.dump"

# 本番ダンプの一時ファイルは必ず消す (メモと画像の実データを含むため)
DUMP=""
cleanup() {
  if [ -n "$DUMP" ]; then
    rm -f "$DUMP"
  fi
}
trap cleanup EXIT

# items / images の件数と memo 全体のハッシュ。件数だけだと中身の欠損を見逃すため、
# 内容そのものを突き合わせる
readonly SIGNATURE_SQL="select (select count(*) from items)||' items / '\
||(select count(*) from images)||' images / memo md5='\
||(select coalesce(md5(string_agg(item_no||':'||memo, '|' order by item_no)), 'なし') from items)"

log "0/7 事前チェック"
[ -f .env ] || die ".env がない。cp .env.example .env して値を設定すること"
local_db pg_isready -U qr -d qr >/dev/null 2>&1 ||
  die "ローカルの db が起動していない。docker compose up -d db を先に実行すること"
remote_reachable ||
  die "$REMOTE に ssh 接続できない"
remote_db pg_isready -U qr -d qr >/dev/null 2>&1 ||
  die "$REMOTE の db が起動していない"
echo "ローカル・$REMOTE とも db は応答している"

echo ""
echo "ローカルの qr データベースを $REMOTE の内容で上書きする (元に戻せない)。"
echo "  上書き前のローカル DB → $LOCAL_BACKUP に退避してから破棄する"
echo "  現在のローカル: $(query_local "$SIGNATURE_SQL")"
echo "  コピー元の$REMOTE : $(query_remote "$SIGNATURE_SQL")"
if [ "${1:-}" != "--yes" ]; then
  read -r -p "続行するか? [y/N] " answer
  case "$answer" in
    [yY] | [yY][eE][sS]) ;;
    *) echo "中止した"; exit 1 ;;
  esac
fi

log "1/7 ローカル DB を退避 ($LOCAL_BACKUP)"
mkdir -p "$BACKUP_DIR"
local_db pg_dump -U qr -d qr -Fc > "$LOCAL_BACKUP"
require_nonempty "$LOCAL_BACKUP" "退避ダンプが空。中止する (ロールバック手段が無い状態では進めない)"
du -h "$LOCAL_BACKUP"

log "2/7 $REMOTE の DB をダンプ取得"
DUMP="$(mktemp "${TMPDIR:-/tmp}/qr-vps2-dump.XXXXXX")"
remote_db pg_dump -U qr -d qr -Fc > "$DUMP"
require_nonempty "$DUMP" "取得したダンプが空"
du -h "$DUMP"

log "3/7 app を停止 (DB 接続を切る)"
docker compose stop app

log "4/7 ローカルの qr データベースを作り直す"
# app 以外の接続 (psql の開きっぱなし等) が残っていると DROP DATABASE が失敗する
query_local "select pg_terminate_backend(pid) from pg_stat_activity
   where datname = 'qr' and pid <> pg_backend_pid()" postgres >/dev/null
# DROP DATABASE はトランザクション内で実行できないため psql を分けて呼ぶ
local_db psql -U qr -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS qr" >/dev/null
local_db psql -U qr -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE qr OWNER qr" >/dev/null

log "5/7 リストア"
# 空の DB へ入れるので --clean は不要。pgroonga 拡張とインデックスもダンプに含まれ、
# 同じイメージのためそのまま復元される
local_db pg_restore --no-owner -U qr -d qr < "$DUMP"

log "6/7 マイグレーション追従"
# ローカルのコードが本番より新しい (未デプロイの migration がある) 場合に適用する。
# 本番と同じなら何も起きない。
#
# compose の migrate サービスは使わない: あれはビルド済みイメージの中の
# prisma/migrations を見るため、イメージが古いと新しい migration が入っておらず
# 「No pending migrations」と言って黙って何もしない。ここは doDeploy.sh と同様に
# ホストの prisma CLI から作業ツリーの migration を直接当てる
npx prisma migrate deploy

log "7/7 検証"
remote_signature="$(query_remote "$SIGNATURE_SQL")"
local_signature="$(query_local "$SIGNATURE_SQL")"
echo "  $REMOTE : $remote_signature"
echo "  ローカル: $local_signature"
if [ "$remote_signature" != "$local_signature" ]; then
  # 6/7 で本番に無い migration を当てた場合、スキーマは変わるが memo の内容は
  # 変わらないため、ここは一致するのが正常。不一致はコピー失敗か、コピー中に
  # 本番が更新されたことを意味する
  die "コピー元と内容が一致しない。$LOCAL_BACKUP から戻せる (手順はこのスクリプト冒頭)"
fi
echo "一致 OK"

# 全文検索が使えることまで確認する。pgroonga インデックスはリストア漏れが
# あっても件数照合では気付けないため、実際に検索して確かめる
if ! query_local "select count(*) from items where memo &@ 'a'" >/dev/null 2>&1; then
  die "PGroonga の全文検索が動かない。インデックスか拡張の復元に失敗している"
fi
if [ "$(query_local "select count(*) from pg_indexes
     where tablename = 'items' and indexdef ilike '%pgroonga%'")" != "1" ]; then
  die "PGroonga インデックスが復元されていない (全文検索が全件走査になる)"
fi
echo "PGroonga 全文検索・インデックス OK"

log "app 起動"
docker compose up -d app

APP_PORT="$(grep -oP '^APP_PORT=\K.*' .env || true)"
# **127.0.0.1 ではなく localhost で叩く**。非本番の proxy.ts は 127.0.0.1 での
# アクセスを localhost へ 307 で送り返す (パスキーが rpID にドメイン名を要求し、
# 127.0.0.1 では使えないため。src/lib/loopbackRedirect.ts)。127.0.0.1 のままだと
# 転送を追わない curl が常に 307 を受け取り、コピーが成功していてもヘルス
# チェックだけが 30 回失敗する。
# doDeploy.sh 側が 127.0.0.1 のままでよいのは、本番 (APP_ENV=production) では
# この転送が起きないから
APP_URL="http://localhost:${APP_PORT:-3000}/"
log "ヘルスチェック ($APP_URL)"
if wait_healthy local_http_status -fsS "$APP_URL"; then
  log "コピー完了: $APP_URL"
  echo "上書き前のローカル DB は $LOCAL_BACKUP に残してある"
  exit 0
fi
die "ヘルスチェックが $HEALTH_RETRIES 回失敗した。docker compose logs app を確認すること"
