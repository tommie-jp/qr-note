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
#
# 世代の上限 (任意): DUMP_KEEP=N を付けたときだけ、検証まで通ったあとに
# 同じ名前の bundle を新しい順に N 本残し、古いものを消す (消した名前は表示する)。
# 付けなければ何も消さない (従来どおり)。doDumpDB-from-vps2.sh と同じ変数なので、
# 両方に同じ値を渡せば DB とノート履歴が同じ世代数そろう。
#   DUMP_KEEP=10 ./doDumpGit-from-vps2.sh
#
# 接続先は scripts/lib/target.sh の prod (DEPLOY_REMOTE / DEPLOY_REMOTE_DIR で上書き可)。
# 旧名 DUMP_REMOTE / DUMP_REMOTE_DIR も引き続き受け付ける。
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh
. scripts/lib/dumpGuard.sh

target_alias DEPLOY_REMOTE DUMP_REMOTE
target_alias DEPLOY_REMOTE_DIR DUMP_REMOTE_DIR
resolve_target prod
OUT="backup/vps2-git-notes_$(date +%Y%m%d_%H%M%S).bundle"
KEEP="${DUMP_KEEP:-}"

# 0 を許すと、いま取ったばかりの 1 本まで消える。ssh の前に弾く
require_keep_count "$KEEP"

mkdir -p backup
remote_compose exec -T app git -C /app/data/git-notes bundle create - --all > "$OUT"

require_nonempty --remove "$OUT" "bundle が空。$REMOTE の app が起動しているか、履歴が作られているか確認すること"

# 非空でも、転送が途中で切れた「壊れた bundle」はサイズ検査を通ってしまう。
# 唯一の DB 外バックアップなので、構造まで検証してから残す
if ! git bundle verify "$OUT" >/dev/null; then
  rm -f "$OUT"
  die "bundle が壊れている (転送が途中で切れた可能性)。取り直すこと"
fi

du -h "$OUT"

# OUT と同じ形の名前だけを数える (DB のダンプなど他のファイルには触らない)
if [ -n "$KEEP" ]; then
  prune_generations "$KEEP" backup/vps2-git-notes_ .bundle
fi
