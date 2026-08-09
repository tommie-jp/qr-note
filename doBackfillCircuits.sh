#!/usr/bin/env bash
# 本番の circuit_svgs を既存ノート全件ぶん描画して埋める
# (一覧の回路図サムネ導入時に 1 回。docs/68-一覧回路図サムネ計画.md §6)。
#
# なぜ専用スクリプトが要るか (doBackfillThumbs.sh と同じ理由):
#   - 本番 (vps2) にはソース (scripts/) が無く、リモートで tsx は動かない。
#   - 描画 (node-tikzjax) はソースを持つローカル機でしか走らせられないので、
#     SSH トンネル越しにローカルから本番 DB を叩く。
#
# 冪等: 描画済みの図は飛ばすので、何度流しても安全。以後の新しい図は
# ノートの表示時に描かれて自然に揃うため、定期実行は要らない。
#
# 使い方 (必ず**ローカル機**で。リモートにはソースが無い):
#   ./doBackfillCircuits.sh
#
# ローカル DB を埋めたいときはこのスクリプトではなく直接:
#   npx tsx scripts/backfillCircuits.ts
#
# 環境変数で上書き可能 (doBackfillThumbs.sh と同じ既定):
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

log "回路図の一括描画 (描画済みは飛ばす)"
# backfillCircuits.ts は全件失敗のときだけ exit 1 を返す
npx tsx scripts/backfillCircuits.ts

log "完了"
