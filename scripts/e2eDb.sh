#!/usr/bin/env bash
# E2E 専用の DB (qr_e2e) を compose の db に作る / 捨てる (docs/96 §4-3)。
#
# シークレットの E2E は鍵束 (1 行しか持てない) を作り、断片は消す口が無い。
# 手元の qr (本物のノート) では走らせず、専用 DB を毎回作り直して向ける。
#
# 使い方:
#   scripts/e2eDb.sh create     qr_e2e を作り、prisma migrate deploy でスキーマを当てる
#   scripts/e2eDb.sh drop       qr_e2e を捨てる
#   scripts/e2eDb.sh url        接続文字列を出す (E2E_DATABASE_URL に渡す)
#
#   E2E_DATABASE_URL="$(scripts/e2eDb.sh url)" E2E_START_SERVER=1 npm run test:e2e:secrets
#
# createdb -T (テンプレート複製) は使わない — PGroonga の索引が壊れる
# (docs/39 §6)。migration を当て直すのが確実で、CI の db-tests と同じ作り方。
# パスワードは .env の POSTGRES_PASSWORD を読む (画面には出さない)。
set -euo pipefail
cd "$(dirname "$0")/.."

. scripts/lib/log.sh

E2E_DB_NAME="${E2E_DB_NAME:-qr_e2e}"

read_env() {
  grep "^$1=" .env | cut -d= -f2- || true
}

db_url() {
  local pw port encoded
  pw="$(read_env POSTGRES_PASSWORD)"
  [ -n "$pw" ] || die ".env に POSTGRES_PASSWORD がない"
  port="$(read_env DB_PORT)"
  encoded="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$pw")"
  echo "postgresql://qr:${encoded}@localhost:${port:-5432}/${E2E_DB_NAME}"
}

# docker compose exec -T は繋いだ stdin を食うので、必ず </dev/null を付ける
db_exec() {
  docker compose exec -T db "$@" </dev/null
}

case "${1:-}" in
  create)
    [ "$E2E_DB_NAME" != "qr" ] || die "本物の DB (qr) は E2E に使わない"
    if db_exec psql -U qr -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = '$E2E_DB_NAME'" | grep -q 1; then
      log "$E2E_DB_NAME は既にある (作り直すなら drop してから)"
    else
      log "$E2E_DB_NAME を作る"
      db_exec createdb -U qr "$E2E_DB_NAME"
    fi
    log "スキーマを当てる (prisma migrate deploy)"
    DATABASE_URL="$(db_url)" npx prisma migrate deploy
    ;;
  drop)
    [ "$E2E_DB_NAME" != "qr" ] || die "本物の DB (qr) は消さない"
    log "$E2E_DB_NAME を捨てる"
    db_exec dropdb -U qr --if-exists "$E2E_DB_NAME"
    ;;
  url)
    db_url
    ;;
  *)
    echo "usage: $0 create | drop | url" >&2
    exit 1
    ;;
esac
