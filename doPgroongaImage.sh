#!/usr/bin/env bash
# 自前ビルドの PGroonga イメージ (deploy/pgroonga/) に db を差し替える。
#
# PostgreSQL の小版を上げるためのもの (18.6 → 18.7 など)。小版はデータ形式が
# 変わらないので、ダンプや入れ直しは要らず、イメージを替えて db を作り直すだけ。
# **大版 (18 → 19) には使わない** — データディレクトリの形式が変わり、起動しない。
#
# 使い方:
#   ./doPgroongaImage.sh local   手元の docker compose
#   ./doPgroongaImage.sh demo    デモ (deploy_host demo の ~/qr-demo)
#   ./doPgroongaImage.sh prod    本番 (deploy_host prod の ~/41-QR-search/qr-search)
#
# 版は手元の compose.yaml の db.image から読む (deploy/pgroonga/Dockerfile の冒頭を参照)。
#
# やること:
#   1. 手元にイメージが無ければビルドする (サーバではビルドしない。vps2 はメモリが足りない)
#   2. サーバに無ければ docker save | gzip | ssh docker load で送る
#   3. 差し替え前に DB をダンプ (backup/<target>-before-pgroonga_<時刻>.dump) し、
#      件数と memo のハッシュを控える
#   4. サーバの compose.yaml の db の image 行だけを書き換える (退避は compose.yaml.pre-<タグ>)。
#      サーバの compose.yaml はリポジトリとずれているので、丸ごとは送らない
#   5. db を作り直し、版・PGroonga の拡張・全文索引での検索・控えとの一致・app の応答を確かめる
#
# 戻すとき: サーバで compose.yaml.pre-<タグ> を compose.yaml に戻して docker compose up -d db
set -euo pipefail
umask 077
cd "$(dirname "$0")"
. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh
. scripts/lib/health.sh
. scripts/lib/dumpGuard.sh

TARGET="${1:-}"
case "$TARGET" in
  local|prod|demo) ;;
  *) echo "usage: $0 local|prod|demo" >&2; exit 2 ;;
esac

# db サービスの image 行 (compose.yaml で最初の image: が db)
IMAGE="$(awk '/^  db:/{f=1} f && /^    image:/{print $2; exit}' compose.yaml)"
case "$IMAGE" in
  qr-note/pgroonga:*) ;;
  *) die "compose.yaml の db.image が自前ビルドではない: '$IMAGE'" ;;
esac
TAG="${IMAGE#*:}"

# 差し替え後に索引を通る検索が動くかを見る。seqscan を切って PGroonga の索引を使わせる
readonly CHECK_SQL="select version();
select 'pgroonga '||extversion from pg_extension where extname='pgroonga';
set enable_seqscan = off;
select 'fts '||count(*) from items where memo &@~ 'the';"

if [ "$TARGET" = local ]; then
  run_db() { local_db "$@"; }
  query() { query_local "$1"; }
  db_compose() { docker compose "$@"; }
else
  resolve_target "$TARGET"
  remote_reachable || die "$REMOTE に ssh できない (Tailscale を確認)"
  run_db() { remote_db "$@"; }
  query() { query_remote "$1"; }
  db_compose() { remote_compose "$@"; }
fi

log "1/5 イメージ $IMAGE を用意"
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "OK: 手元にある"
else
  docker build -t "$IMAGE" deploy/pgroonga
fi
docker run --rm --entrypoint postgres "$IMAGE" --version

if [ "$TARGET" != local ]; then
  log "2/5 $REMOTE へ送る"
  if remote_ssh "$REMOTE" "docker image inspect '$IMAGE' >/dev/null 2>&1"; then
    echo "OK: 既にある"
  else
    docker save "$IMAGE" | gzip -1 | remote_ssh "$REMOTE" "gunzip | docker load"
  fi
fi

log "3/5 差し替え前のダンプと控え"
mkdir -p backup
DUMP="backup/${TARGET}-before-pgroonga_$(date +%Y%m%d_%H%M%S).dump"
run_db pg_dump -Fc -U qr -d qr </dev/null >"$DUMP"
require_nonempty --remove "$DUMP" "ダンプが空 ($DUMP)。差し替えずに止める"
echo "OK: $DUMP ($(du -h "$DUMP" | cut -f1))"
BEFORE="$(query "$DB_SIGNATURE_SQL")"
echo "前: $BEFORE"

log "4/5 compose.yaml の db.image を $IMAGE に"
if [ "$TARGET" != local ]; then
  # db サービスの中の image 行だけを置き換える (app・caddy の image 行には触れない)
  remote_ssh "$REMOTE" "cd '$REMOTE_DIR' &&
    { [ -e 'compose.yaml.pre-$TAG' ] || cp compose.yaml 'compose.yaml.pre-$TAG'; } &&
    awk -v img='$IMAGE' '/^  db:/{f=1} /^  [a-z]/ && !/^  db:/{f=0}
      f && /^    image:/ && !done {sub(/image: .*/, \"image: \" img); done=1} {print}' \
      compose.yaml > compose.yaml.new && mv compose.yaml.new compose.yaml &&
    grep -n 'pgroonga' compose.yaml"
else
  grep -n "image: $IMAGE" compose.yaml
fi

log "5/5 db を作り直して確かめる"
db_compose up -d --no-build db
for i in $(seq 1 30); do
  if run_db pg_isready -U qr -d qr </dev/null >/dev/null 2>&1; then break; fi
  [ "$i" = 30 ] && die "db が起動しない (docker compose logs db を見る)"
  sleep 2
done
query "$CHECK_SQL"
AFTER="$(query "$DB_SIGNATURE_SQL")"
echo "後: $AFTER"
[ "$BEFORE" = "$AFTER" ] || die "差し替えの前後で中身が一致しない (戻し方は冒頭のコメント)"
echo "OK: 前後一致"

if [ "$TARGET" = local ]; then
  echo "(手元の app は ./doStart.sh で確かめる)"
else
  # app の接続プールは切られた接続を張り直す。応答が戻るまで待つ
  if ! wait_healthy remote_http_status "http://127.0.0.1:$REMOTE_APP_PORT/"; then
    die "app が応答しない (docker compose restart app を試す)"
  fi
fi
log "完了: $TARGET の db は $IMAGE"
