#!/usr/bin/env bash
# アプリ実行時用の DB ロール qr_app を作る / 揃える (2026-11 のセキュリティ監査 C-2)。
#
# それまでアプリは superuser の `qr` で接続していた。SQL 注入は見つかっていないが、
# 万一のときに `COPY … PROGRAM` などで DB コンテナ内のコード実行まで広がる。
# 実行時は DML だけの `qr_app` にし、マイグレーション (prisma migrate deploy) と
# 運用スクリプトは今までどおり `qr` で行う。
#
# やること (冪等。何度流しても同じ状態になる):
#   1. 対象の .env に APP_DB_PASSWORD が無ければ乱数で作って追記する (umask 077)
#   2. db コンテナの psql で qr_app を作り (無ければ)、パスワードを揃え、
#      public スキーマの全テーブルに SELECT/INSERT/UPDATE/DELETE、全シーケンスに
#      USAGE/SELECT を与え、**`qr` が今後作るテーブル・シーケンスにも同じ権限が付く**
#      ように ALTER DEFAULT PRIVILEGES を置く (migrate で増える表に追い付くため)
#   3. デモは種の DB (qr_seed) にも同じことをする — 毎時の再シードは createdb -T で
#      種を写すので、種に権限が無いと写した先で app が読めなくなる
#
# compose.yaml の DATABASE_URL は qr_app + APP_DB_PASSWORD を使う。**この script を
# 流してから** `./doDeploy.sh … --send-compose.yml` で配ること (順が逆だと app が
# 起動時に接続できない)。
#
# 使い方:
#   ./doDbRole.sh local        手元の docker compose (./.env)
#   ./doDbRole.sh prod         本番 (deploy_host prod の ~/41-QR-search/qr-search)
#   ./doDbRole.sh demo         デモ (deploy_host demo の ~/qr-demo。qr と qr_seed)
set -euo pipefail
umask 077
cd "$(dirname "$0")"
. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh

TARGET="${1:-}"
case "$TARGET" in
  local|prod|demo) ;;
  *) echo "usage: $0 local|prod|demo" >&2; exit 2 ;;
esac

ROLE="qr_app"
ADMIN_USER="qr"

# 権限の SQL。psql の変数 :'pw' でパスワードを渡す (シェルの文字列連結で SQL を組まない)
GRANT_SQL=$(cat <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qr_app') THEN
    CREATE ROLE qr_app LOGIN;
  END IF;
END
$$;
ALTER ROLE qr_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'pw';
GRANT CONNECT ON DATABASE :"db" TO qr_app;
GRANT USAGE ON SCHEMA public TO qr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qr_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qr IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qr IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO qr_app;
SQL
)

# 乱数のパスワード (URL に載せるので英数字だけ)
new_password() {
  openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 40
}

# ---- 手元 ----
if [ "$TARGET" = "local" ]; then
  ENV_FILE=".env"
  if ! grep -q '^APP_DB_PASSWORD=' "$ENV_FILE"; then
    printf '\n# アプリ実行時の DB ロール qr_app のパスワード (./doDbRole.sh が作った)\nAPP_DB_PASSWORD=%s\n' "$(new_password)" >> "$ENV_FILE"
    log "APP_DB_PASSWORD を $ENV_FILE に追記した"
  fi
  pw="$(grep '^APP_DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
  log "qr_app を揃える (local / qr)"
  # SQL は stdin (here-string) で渡す。</dev/null を重ねると stdin が空になり何も流れない
  docker compose exec -T db psql -U "$ADMIN_USER" -d qr -v ON_ERROR_STOP=1 -v pw="$pw" -v db=qr -q <<<"$GRANT_SQL"
  log "完了。compose を上げ直す: docker compose up -d app"
  exit 0
fi

# ---- リモート ----
resolve_target "$TARGET"
log "対象: $REMOTE:$REMOTE_DIR"

# .env に無ければ追記 (リモート側で作る。パスワードを手元に残さない)
remote_ssh "$REMOTE" "cd '$REMOTE_DIR' && if ! grep -q '^APP_DB_PASSWORD=' .env; then umask 077; printf '\n# アプリ実行時の DB ロール qr_app のパスワード (doDbRole.sh が作った)\nAPP_DB_PASSWORD=%s\n' \"\$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 40)\" >> .env; echo 追記した; else echo 既にある; fi"

pw="$(remote_env_var APP_DB_PASSWORD)"
[ -n "$pw" ] || die "$REMOTE の .env から APP_DB_PASSWORD を読めない"

DBS="qr"
if [ "$TARGET" = "demo" ]; then
  DBS="qr $DEMO_SEED_DB"
fi
for db in $DBS; do
  log "qr_app を揃える ($TARGET / $db)"
  # SQL は stdin で渡す。パスワードは psql の変数 (ps に出ない)
  printf '%s' "$GRANT_SQL" | remote_ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose exec -T db psql -U $ADMIN_USER -d $db -v ON_ERROR_STOP=1 -v pw='$pw' -v db=$db -q"
done
log "完了。次は ./doDeploy.sh … --send-compose.yml で compose.yaml (qr_app の DATABASE_URL) を配る"
