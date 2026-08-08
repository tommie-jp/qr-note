#!/usr/bin/env bash
# 本番/デモの items.title を本文から切り出し直す (docs/63-タイトル順計画.md §4)。
#
# **列を足したデプロイの直後に 1 回流すこと。** マイグレーションは既存行を '' の
# まま置くので、流さないと「タイトル順」が全件同着 (= 番号順) にしか見えない。
#
# なぜ専用スクリプトが要るか (doBackfillTaskCounts.sh と同じ事情):
#   - 本番 (vps2) の compose ディレクトリには compose.yaml と .env しか無く、
#     ソース (scripts/) が無い。アプリはローカルでビルドした Docker イメージを
#     動かすだけなので、リモートで `tsx scripts/...` は動かない。
#   - 見出しの切り出し (src/lib/memoSummary.ts) は Markdown の解析なので SQL では
#     代用できない。そこで prisma migrate deploy と同じく、SSH トンネル越しに
#     **ローカルから本番 DB を叩く** (doDeploy.sh 手順 6/8 と同じ仕掛け)。
#
# 派生キャッシュなので何度流しても安全 (冪等)。値が既に合っている行は書かない。
#
# 使い方 (必ず**ローカル機**で。リモートにはソースが無い):
#   ./doBackfillTitles.sh          # 本番 (vps2)
#
#   デモインスタンスへ (live と種 qr_seed の両方に当てる):
#     DEPLOY_REMOTE_DIR=qr-demo DEPLOY_DB_PORT=5433 ./doBackfillTitles.sh
#     DEPLOY_REMOTE_DIR=qr-demo DEPLOY_DB_PORT=5433 DEPLOY_DB_NAME=qr_seed \
#       ./doBackfillTitles.sh
#
# 環境変数で上書き可能 (doDeploy.sh と同じ既定):
#   DEPLOY_REMOTE      ssh 接続先 (default: vps2)
#   DEPLOY_REMOTE_DIR  リモートの compose ディレクトリ ($HOME 相対, default: 41-QR-search/qr-search)
#   DEPLOY_TUNNEL_PORT トンネルのローカルポート (default: 15432)
#   DEPLOY_DB_PORT     リモート側 DB ポート (default: 5432。デモは 5433)
#   DEPLOY_DB_NAME     DB 名 (default: qr。デモの種を直すときは qr_seed)
set -euo pipefail
cd "$(dirname "$0")"

REMOTE="${DEPLOY_REMOTE:-vps2}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-41-QR-search/qr-search}"
TUNNEL_PORT="${DEPLOY_TUNNEL_PORT:-15432}"
REMOTE_DB_PORT="${DEPLOY_DB_PORT:-5432}"
DB_NAME="${DEPLOY_DB_NAME:-qr}"

[ "$#" -eq 0 ] || { echo "usage: $0   (引数なし。デモは環境変数で切替)" >&2; exit 1; }

log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# SSH トンネルは ControlMaster で管理し、終了時に必ず閉じる (doDeploy.sh と同じ)
SSH_CTRL="$(mktemp -u "${TMPDIR:-/tmp}/qr-titles-ssh.XXXXXX")"
cleanup() {
  ssh -S "$SSH_CTRL" -O exit "$REMOTE" 2>/dev/null || true
}
trap cleanup EXIT

log "リモート $REMOTE:$REMOTE_DIR の DB $DB_NAME (port $REMOTE_DB_PORT) を対象にする"

REMOTE_PW="$(ssh "$REMOTE" "grep '^POSTGRES_PASSWORD=' '$REMOTE_DIR/.env' | cut -d= -f2-")"
[ -n "$REMOTE_PW" ] || die "$REMOTE の $REMOTE_DIR/.env から POSTGRES_PASSWORD を取得できない"
ENCODED_PW="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$REMOTE_PW")"

ssh -M -S "$SSH_CTRL" -f -N \
  -L "127.0.0.1:${TUNNEL_PORT}:127.0.0.1:${REMOTE_DB_PORT}" \
  -o ExitOnForwardFailure=yes "$REMOTE"

export DATABASE_URL="postgresql://qr:${ENCODED_PW}@127.0.0.1:${TUNNEL_PORT}/${DB_NAME}"

log "見出しを切り出し直す"
npx tsx scripts/backfillTitles.ts

log "完了"
