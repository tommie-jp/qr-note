#!/usr/bin/env bash
# 本番/デモの images.thumb を作り直す (サムネ生成パラメータを変えたとき用)。
#
# なぜ専用スクリプトが要るか:
#   - 本番 (vps2) の ~/41-QR-search/qr-search/ には compose.yaml と .env しか
#     無く、ソース (scripts/) が無い。アプリはローカルでビルドした Docker
#     イメージを動かすだけなので、リモートで `tsx scripts/...` は動かない。
#   - サムネ生成 (src/lib/thumbnail.ts) は **ソースを持つローカル機** でしか
#     走らせられない。そこで prisma migrate deploy と同じく、SSH トンネル越しに
#     ローカルから本番 DB を叩く (doDeploy.sh 手順 6/8 と同じ仕掛け)。
#
# 使うのはこういうとき:
#   - THUMB_MAX_PX や fit などサムネ生成パラメータを変えた後 (docs/32 §1)。
#   - このとき memoImages.ts の THUMB_VERSION も上げてキャッシュを割ること。
#     版だけ上げても DB の thumb を作り直さないと、割った先で旧サムネを取り直す
#     だけで見た目は変わらない。
#
# 使い方 (必ず**ローカル機**で。リモートにはソースが無い):
#   ./doBackfillThumbs.sh            # 本番 (vps2) の thumb を --force で作り直す
#
#   デモインスタンスへ (live と種 qr_seed の両方を作り直すラッパを使う):
#     ./doBackfillThumbs-demo.sh
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
SSH_CTRL="$(mktemp -u "${TMPDIR:-/tmp}/qr-backfill-ssh.XXXXXX")"
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

log "サムネ再生成 (--force)"
# 画像以外の添付 (.pdf/.m4a/.webm など) は「対象外」として黙って飛ばされる。
# backfillThumbs.ts は全件失敗のときだけ exit 1 を返す
# --conditions=react-server … src/lib のサーバ専用 module は import 'server-only' を
# 持ち、この条件で解決しないと import した瞬間に throw する (docs/93 §2-2)
npx tsx --conditions=react-server scripts/backfillThumbs.ts --force

log "完了"
