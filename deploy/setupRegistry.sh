#!/usr/bin/env bash
# vps2 に私設 Docker レジストリ (registry:3) を一度きり設置する。
# doDeploy.sh 4/8 のレイヤー差分転送先。詳細は docs/41-デプロイ高速化.md。
#
# 環境変数 (doDeploy.sh と共通):
#   DEPLOY_REMOTE        ssh 接続先 (default: vps2)
#   DEPLOY_REGISTRY_DIR  リモートの設置ディレクトリ ($HOME 相対, default: registry)
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${DEPLOY_REMOTE:-vps2}"
REGISTRY_DIR="${DEPLOY_REGISTRY_DIR:-registry}"
REGISTRY_REMOTE_PORT="${DEPLOY_REGISTRY_REMOTE_PORT:-5000}"

echo "==> $REMOTE:$REGISTRY_DIR に registry-compose.yaml を配置"
ssh "$REMOTE" "mkdir -p '$REGISTRY_DIR'"
scp -q deploy/registry-compose.yaml "$REMOTE:$REGISTRY_DIR/compose.yaml"

echo "==> registry:3 を起動"
ssh "$REMOTE" "cd '$REGISTRY_DIR' && docker compose up -d"

echo "==> 疎通確認"
if ssh "$REMOTE" "curl -fsS 'http://127.0.0.1:${REGISTRY_REMOTE_PORT}/v2/' >/dev/null"; then
  echo "OK: レジストリ稼働中。以降 ./doDeploy.sh で差分転送される。"
else
  echo "ERROR: レジストリに到達できない。'ssh $REMOTE \"cd $REGISTRY_DIR && docker compose logs\"' を確認" >&2
  exit 1
fi
