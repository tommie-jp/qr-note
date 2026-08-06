#!/usr/bin/env bash
#
# 本番 (vps2) のノート git 履歴のバックアップを取る。ローカルから実行する。
# 出力先: backup/vps2-git-notes_<timestamp>.bundle
#
# メモと画像は pg_dump (doDumpDB-from-vps2.sh) で揃うが、git 履歴だけは
# DB の外にある唯一の永続データ (docs/57-ノートgit履歴計画.md §7)。
# bundle は履歴全体の整合したスナップショット 1 ファイルで、戻すときは
# そのまま clone できる:
#
#   git clone backup/vps2-git-notes_<timestamp>.bundle restored-git-notes
#   (中身を volume の /app/data/git-notes へ戻す)
#
# set -euo pipefail と中身の検査が要点。**これが無いと ssh が失敗しても
# リダイレクトで 0 バイトのファイルが残り、「バックアップがある」ように
# 見えてしまう** (doDumpDB-from-vps2.sh と同じ理由)。
set -euo pipefail
cd "$(dirname "$0")"

REMOTE="${DUMP_REMOTE:-vps2}"
REMOTE_DIR="${DUMP_REMOTE_DIR:-41-QR-search/qr-search}"
OUT="backup/vps2-git-notes_$(date +%Y%m%d_%H%M%S).bundle"

mkdir -p backup
ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose exec -T app git -C /app/data/git-notes bundle create - --all" > "$OUT"

if [ ! -s "$OUT" ]; then
  rm -f "$OUT"
  echo "ERROR: bundle が空。$REMOTE の app が起動しているか、履歴が作られているか確認すること" >&2
  exit 1
fi

# 非空でも、転送が途中で切れた「壊れた bundle」はサイズ検査を通ってしまう。
# 唯一の DB 外バックアップなので、構造まで検証してから残す
if ! git bundle verify "$OUT" >/dev/null; then
  rm -f "$OUT"
  echo "ERROR: bundle が壊れている (転送が途中で切れた可能性)。取り直すこと" >&2
  exit 1
fi

du -h "$OUT"
