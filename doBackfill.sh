#!/usr/bin/env bash
# 本番/デモ DB の派生データを、ソースを持つローカル機から埋め直す。
#
# 使い方 (必ず**ローカル機**で。リモートにはソースが無い):
#   ./doBackfill.sh <タスク>           本番 (vps2) の qr
#   ./doBackfill.sh <タスク> --demo    デモの live (qr) と種 (qr_seed) の両方
#   ./doBackfill.sh <タスク> --seed    デモの種 (qr_seed) だけ
#   ./doBackfill.sh -h                 (この説明を表示)
#
# タスク:
#   titles      items.title を本文から切り出し直す (docs/63-タイトル順計画.md §4)。
#               **列を足したデプロイの直後に 1 回流すこと。** マイグレーションは既存行を
#               '' のまま置くので、流さないと「タイトル順」が全件同着 (= 番号順) にしか
#               見えない。見出しの切り出し (src/lib/memoSummary.ts) は Markdown の解析
#               なので SQL では代用できない。
#   taskcounts  items.task_todo / task_done を本文から数え直す (docs/56-チェック検索計画.md §4)。
#               **列を足したデプロイの直後に 1 回流すこと。** マイグレーションは既存行を
#               0 のまま置くので、流さないと `is:todo` が常に 0 件になる (検索が壊れて
#               見える)。数え方 (src/lib/taskCheckbox.ts の countTasks) は remark を通す JS。
#   thumbs      images.thumb を --force で作り直す。THUMB_MAX_PX や fit などサムネ生成
#               パラメータを変えた後に使う (docs/32 §1)。このとき memoImages.ts の
#               THUMB_VERSION も上げてキャッシュを割ること。版だけ上げても DB の thumb を
#               作り直さないと、割った先で旧サムネを取り直すだけで見た目は変わらない。
#               画像以外の添付 (.pdf/.m4a/.webm など) は「対象外」として黙って飛ばされる。
#   circuits    circuit_svgs を既存ノート全件ぶん描画して埋める (一覧の回路図サムネ導入時に
#               1 回。docs/68-一覧回路図サムネ計画.md §6)。以後の新しい図はノートの表示時に
#               描かれて自然に揃うため、定期実行は要らない。
#
# どれも派生キャッシュなので何度流しても安全 (冪等)。値が既に合っている行・描画済みの
# 図は書かない。backfill*.ts は全件失敗のときだけ exit 1 を返す。
#
# 以前は doBackfillTitles.sh / doBackfillTaskCounts.sh / doBackfillThumbs.sh /
# doBackfillCircuits.sh / doBackfillThumbs-demo.sh の 5 本だった (docs/93-リファクタリング計画.md §7-2)。
#
# なぜ専用スクリプトが要るか:
#   - 本番 (vps2) の compose ディレクトリには compose.yaml と .env しか無く、
#     ソース (scripts/) が無い。アプリはローカルでビルドした Docker イメージを
#     動かすだけなので、リモートで `tsx scripts/...` は動かない。
#   - そこで prisma migrate deploy と同じく、SSH トンネル越しに**ローカルから
#     本番 DB を叩く** (doDeploy.sh 手順 6/8 と同じ仕掛け)。
#
# titles と taskcounts は `./doDeploy.sh` が毎回流している (--demo なら live と種の両方)。
# 手で流すのは「デプロイとは別に直したい」ときだけ。
#
# --demo が live と種の両方に当てる理由: デモは毎時 `createdb -T qr_seed qr` で
# リセットされる (docs/39-デモ公開計画.md §6) ため、live の qr だけ直しても次のリセットで
# 巻き戻る。live と種の両方に同じ処理を当てて初めて定着する。
# 接続先 (qr-demo / DB ポート 5433) は旗でまとめて切り替える。手打ちの env で
# ポートを忘れると、デモのつもりで**本番 (5432) を書き換えてしまう**ため。
#
# ローカル DB を埋めたいときはこのスクリプトではなく直接:
#   npx tsx --conditions=react-server scripts/backfillCircuits.ts   (他のタスクも同様)
#
# 環境変数で上書き可能 (値があれば旗の既定より勝つ。既定は scripts/lib/target.sh):
#   DEPLOY_REMOTE      ssh 接続先 (default: vps2)
#   DEPLOY_REMOTE_DIR  リモートの compose ディレクトリ ($HOME 相対,
#                      default: 41-QR-search/qr-search / --demo・--seed: qr-demo)
#   DEPLOY_TUNNEL_PORT トンネルのローカルポート (default: 15432)
#   DEPLOY_DB_PORT     リモート側 DB ポート (default: 5432 / --demo・--seed: 5433)
#   DEPLOY_DB_NAME     DB 名 (default: qr / --seed: qr_seed)
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh

usage() {
  echo "usage: $0 <titles|taskcounts|thumbs|circuits> [--demo | --seed]" >&2
  echo "       $0 -h    (詳しい説明)" >&2
  exit 1
}

# -h: このスクリプト冒頭のコメントをそのまま説明として出す (doDeploy.sh と同じ)
help() {
  sed -n '2,/^set -euo pipefail$/ { /^#/ s/^# \{0,1\}//p }' "$0"
  exit 0
}

TASK=""
DEMO=0
SEED=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) help ;;
    --demo) DEMO=1 ;;
    --seed) SEED=1 ;;
    titles|taskcounts|thumbs|circuits)
      [ -z "$TASK" ] || usage
      TASK="$arg"
      ;;
    *) usage ;;
  esac
done
[ -n "$TASK" ] || usage

# タスク → 見出しと、tsx に渡すスクリプト + 引数
case "$TASK" in
  titles) TASK_LABEL="見出しを切り出し直す"; TASK_ARGS=(scripts/backfillTitles.ts) ;;
  taskcounts) TASK_LABEL="タスク数を数え直す"; TASK_ARGS=(scripts/backfillTaskCounts.ts) ;;
  thumbs) TASK_LABEL="サムネ再生成 (--force)"; TASK_ARGS=(scripts/backfillThumbs.ts --force) ;;
  circuits) TASK_LABEL="回路図の一括描画 (描画済みは飛ばす)"; TASK_ARGS=(scripts/backfillCircuits.ts) ;;
esac

# 当てる DB の並び。--seed が付けば種だけ (--demo と併記しても種だけ)
if [ "$SEED" = 1 ]; then
  TARGETS=(demo-seed)
elif [ "$DEMO" = 1 ]; then
  TARGETS=(demo demo-seed)
else
  TARGETS=(prod)
fi

TUNNEL_PORT="${DEPLOY_TUNNEL_PORT:-15432}"

# 種だけは書く前に PGroonga を直す。**読むだけなら要らないが、書くには要る。**
#
# 種は `createdb -T qr` (テンプレート複製) で撮るので Groonga の内部構造が
# 壊れた状態で生まれる (docs/39-デモ公開計画.md §6-2)。壊れた索引のまま
# items を UPDATE すると
#   pgroonga: PGrnLookupWithSize: object isn't found: <Sources…>
# で落ちる。しかも backfillTitles.ts の UPDATE は 1 文ずつ確定するので、
# **途中で落ちると種が半分だけ直った状態で残り**、それが次の毎時リセットで
# live へ複製される (直したつもりで悪化する)。
#
# live は対象外。本番の qr は複製で生まれておらず、デモの live は
# reseedDemo.sh が複製の直後に REINDEX している。
#
# </dev/null … docker compose exec -T は繋いだ stdin を食い尽くすので、
# 塞がないと後続のコマンドが黙って実行されなくなる
reindex_seed_if_needed() {
  [ "$TASK" = titles ] && [ "$REMOTE_DB_NAME" = "$DEMO_SEED_DB" ] || return 0
  log "種の PGroonga を REINDEX (壊れた索引のままでは UPDATE が落ちる)"
  remote_db "psql -U qr -d $REMOTE_DB_NAME -c 'REINDEX DATABASE $REMOTE_DB_NAME'" </dev/null
}

# SSH トンネルは ControlMaster で管理し、終了時に必ず閉じる (doDeploy.sh と同じ)。
# live と種は同じ Postgres の別 DB なので、1 本のトンネルを DB 名だけ変えて使い回す
ssh_master_init backfill
trap ssh_master_close EXIT

DB_URL=""
for target in "${TARGETS[@]}"; do
  resolve_target "$target"
  log "リモート $REMOTE:$REMOTE_DIR の DB $REMOTE_DB_NAME (port $REMOTE_DB_PORT) を対象にする"

  if [ -z "$DB_URL" ]; then
    DB_URL="$(remote_db_url "$TUNNEL_PORT" "$REMOTE_DB_NAME")"
    ssh_master_open "$TUNNEL_PORT" "$REMOTE_DB_PORT"
  fi
  export DATABASE_URL="${DB_URL%/*}/${REMOTE_DB_NAME}"

  reindex_seed_if_needed

  log "$TASK_LABEL"
  # --conditions=react-server … src/lib のサーバ専用 module は import 'server-only' を
  # 持ち、この条件で解決しないと import した瞬間に throw する (docs/93 §2-2)
  npx tsx --conditions=react-server "${TASK_ARGS[@]}"
done

if [ "${#TARGETS[@]}" -gt 1 ]; then
  log "完了 (デモの live (qr) と種 ($DEMO_SEED_DB) の両方に当てた)"
else
  log "完了"
fi
