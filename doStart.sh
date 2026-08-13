#!/usr/bin/env bash
# qr-search をローカルで本番相当 (docker compose) に起動する。
# db 起動 → DB マイグレーション → app 起動 → ヘルスチェック。
#
# 使い方:
#   ./doStart.sh            # イメージを作り直してから起動
#   ./doStart.sh --nobuild  # ビルドせず既存イメージのまま起動
#   ./doStart.sh -h         # ヘルプを表示
#
# 停止は: docker compose down
# Caddy (HTTPS + Basic 認証) 込みで試す場合は:
#   docker compose --profile proxy up -d
set -euo pipefail
cd "$(dirname "$0")"

log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
qr-search をローカルで本番相当 (docker compose) に起動する。
db 起動 → DB マイグレーション → app 起動 → ヘルスチェック。

使い方:
  ./doStart.sh            # イメージを作り直してから起動
  ./doStart.sh --nobuild  # ビルドせず既存イメージのまま起動
  ./doStart.sh -h         # このヘルプを表示

注意: --nobuild は既存イメージのまま起動するため、package.json のバージョンなど
ビルド時に埋め込まれる値は古いままになる。

停止は: docker compose down
Caddy (HTTPS + Basic 認証) 込みで試す場合は:
  docker compose --profile proxy up -d
EOF
}

DO_BUILD=1

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --nobuild) DO_BUILD=0 ;;
    --build) DO_BUILD=1 ;;
    *) usage >&2; die "不明な引数: $arg" ;;
  esac
done

[ -f .env ] || die ".env がない。cp .env.example .env して値を設定すること"

APP_PORT="$(grep -oP '^APP_PORT=\K.*' .env || true)"

# ヘルスチェックは compose がバインドしているアドレスを直に叩く。
# compose.yaml の指定は 127.0.0.1:<port>:3000 (IPv4 のみ) なので、
# localhost だと ::1 を先に引いて空振りしうる
HEALTH_URL="http://127.0.0.1:${APP_PORT:-3000}/"

# 画面に出すのは localhost のほう。**パスキー (WebAuthn) は rpID に
# ドメイン名を要求し、IP アドレスでは使えない** (docs/29-パスキー計画.md §7)。
# 127.0.0.1:3000 で開くとパスキーの登録もログインもできないので、
# 案内する URL 自体を localhost にしておく
APP_URL="http://localhost:${APP_PORT:-3000}/"

HEALTH_RETRIES=30

if [ "$DO_BUILD" = 1 ]; then
  log "イメージビルド"
  # Dockerfile の依存レイヤーが読む .deps/ を作る (git 管理外の生成物)。
  # 無いと COPY が落ちる (docs/80-デプロイ再高速化計画.md §S1)
  node scripts/writeDepsManifest.mjs
  docker compose build app
else
  log "イメージビルドをスキップ (--nobuild)"
fi

log "db 起動"
docker compose up -d --wait db

log "DB マイグレーション"
# compose の migrate サービスは使わない (削除済み): あれはビルド済みイメージの中の
# prisma/migrations を見るため、イメージが古いと新しい migration が入っておらず
# 「No pending migrations」と言って黙って何もしない。実際ローカルのイメージは
# init 1 件しか持っていなかった。doDeploy.sh と同様にホストの prisma CLI から
# 作業ツリーの migration を直接当てる
npx prisma migrate deploy

log "app 起動"
docker compose up -d app

log "ヘルスチェック ($HEALTH_URL)"
for i in $(seq 1 "$HEALTH_RETRIES"); do
  # -L で転送を追う。非本番の app は 127.0.0.1 を localhost へ 307 で
  # 送り返すため (パスキーが IP では使えないので。src/lib/loopbackRedirect.ts)、
  # 追わないとヘルスチェックが 307 のまま失敗する
  status="$(curl -fsSL -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
  if [ "$status" = "200" ]; then
    echo "OK: HTTP $status"
    log "起動完了: $APP_URL"
    exit 0
  fi
  echo "  waiting... ($i/$HEALTH_RETRIES, status=${status:-none})"
  sleep 2
done
die "ヘルスチェックが $HEALTH_RETRIES 回失敗した。'docker compose logs app' を確認すること"
