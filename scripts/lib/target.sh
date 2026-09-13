# shellcheck shell=bash
# do*.sh 共通: 配布先 (prod | demo | demo-seed) の接続先を 1 度で決める
# (docs/93-リファクタリング計画.md §7-2)。log.sh の die を使うので、先に log.sh を source すること。
#
#   resolve_target <prod|demo|demo-seed>
#
# 決めるもの (括弧内は prod / demo / demo-seed の既定):
#   REMOTE           ssh 接続先 (vps2 / vps2 / vps2)
#   REMOTE_DIR       リモートの compose ディレクトリ、$HOME 相対
#                    (41-QR-search/qr-search / qr-demo / qr-demo)
#   REMOTE_DB_PORT   リモート側 DB ポート (5432 / 5433 / 5433)
#   REMOTE_APP_PORT  リモート側 app ポート (3000 / 3100 / 3100)
#   REMOTE_DB_NAME   DB 名 (qr / qr / qr_seed)
#
# **3 点 (ディレクトリ / DB ポート / app ポート) を束で切り替えるのが要点。**
# 以前は env を手で並べていたので、デモのつもりで DEPLOY_APP_PORT を書き忘れると
# ヘルスチェックが本番 app (3000) を叩いて誤って成功と判定し、DEPLOY_DB_PORT を
# 忘れると本番 DB を書き換えた (docs/39-デモ公開計画.md §5)。
#
# 出力の名前に REMOTE_ を付けるのは、素の APP_PORT / DB_PORT が compose.yaml の
# ポート指定の変数と同名だから。export 済みの環境でスクリプトが上書きすると、
# 同じスクリプトが叩くローカルの `docker compose` まで別のポートで動いてしまう。
#
# 環境変数で上書きできる (値があれば既定より勝つ):
#   DEPLOY_REMOTE / DEPLOY_REMOTE_DIR / DEPLOY_DB_PORT / DEPLOY_APP_PORT / DEPLOY_DB_NAME
#
# ssh 接続先の変数名はかつてスクリプトごとに 5 種類あった (DEPLOY_REMOTE・COPY_REMOTE・
# DUMP_REMOTE・IMPORT_REMOTE・DEMO_SSH_HOST)。正式名は DEPLOY_* に揃え、旧名は
# 各スクリプトが target_alias で写して引き続き受け付ける (シェルの設定に書いた
# 旧名を壊さないため)。旧名に値があれば、そのスクリプトでは旧名が勝つ。

DEMO_SEED_DB="qr_seed"   # デモの毎時リセットの種 (docs/39-デモ公開計画.md §6)

# target_alias <正式名> <旧名>
# 旧名に値があれば正式名へ写す (旧名が勝つ)。無ければ何もしない
target_alias() {
  local canonical="$1" legacy="$2"
  if [ -n "${!legacy:-}" ]; then
    printf -v "$canonical" '%s' "${!legacy}"
  fi
}

resolve_target() {
  local dir db_port app_port db_name
  case "$1" in
    prod) dir="41-QR-search/qr-search"; db_port=5432; app_port=3000; db_name=qr ;;
    demo) dir="qr-demo"; db_port=5433; app_port=3100; db_name=qr ;;
    demo-seed) dir="qr-demo"; db_port=5433; app_port=3100; db_name="$DEMO_SEED_DB" ;;
    *) die "未知の配布先: $1 (prod | demo | demo-seed)" ;;
  esac
  REMOTE="${DEPLOY_REMOTE:-vps2}"
  REMOTE_DIR="${DEPLOY_REMOTE_DIR:-$dir}"
  REMOTE_DB_PORT="${DEPLOY_DB_PORT:-$db_port}"
  REMOTE_APP_PORT="${DEPLOY_APP_PORT:-$app_port}"
  REMOTE_DB_NAME="${DEPLOY_DB_NAME:-$db_name}"
}
