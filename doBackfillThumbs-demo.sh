#!/usr/bin/env bash
# デモ (qr-demo) の images.thumb を作り直す doBackfillThumbs.sh の薄いラッパ。
#
# なぜラッパを分けるか (doDeploy.sh の --demo と同じ理由):
#  1. env を固定する。手打ちで DEPLOY_DB_PORT=5433 を忘れると、
#     デモのつもりで**本番 (5432) の thumb を作り直してしまう**。
#  2. **種 qr_seed も作り直す**。デモは毎時 `createdb -T qr_seed qr` で
#     リセットされる (docs/39 §6) ため、live の qr だけ直しても次のリセットで
#     旧サムネに巻き戻る。live と種の両方に同じ処理を当てて初めて定着する。
#
# 使い方 (必ずローカル機で。doBackfillThumbs.sh と同じ前提):
#   ./doBackfillThumbs-demo.sh
set -euo pipefail
cd "$(dirname "$0")"

[ "$#" -eq 0 ] || { echo "usage: $0   (引数なし)" >&2; exit 1; }

# 1. live (qr)
DEPLOY_REMOTE_DIR=qr-demo DEPLOY_DB_PORT=5433 ./doBackfillThumbs.sh

# 2. 種 (qr_seed)。リセットで巻き戻らないよう種にも同じ処理を当てる
DEPLOY_REMOTE_DIR=qr-demo DEPLOY_DB_PORT=5433 DEPLOY_DB_NAME=qr_seed \
  ./doBackfillThumbs.sh

echo ""
echo "==> デモの live (qr) と種 (qr_seed) の両方を作り直した"
