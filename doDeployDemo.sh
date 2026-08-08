#!/usr/bin/env bash
# デモインスタンス (qr-demo) をデプロイする doDeploy.sh の薄いラッパ。
# デモ専用の doDeploy.sh は不要で、これは env の固定と「種のスキーマ同期」を
# 足すだけ (docs/39-デモ公開計画.md §5)。
#
# なぜラッパを分けるか:
#  1. デモのポート/ディレクトリを固定する。手打ち env で DEPLOY_APP_PORT を
#     忘れると、ヘルスチェックが**本番 app(3000) を叩いて誤って成功と判定**する。
#  2. **migration の罠を自動で塞ぐ** (docs/39 §6-3)。deploy は live の qr を
#     migrate するが、種 qr_seed は旧スキーマのまま残り、次の毎時リセットで
#     `createdb -T qr_seed qr` がスキーマを巻き戻して app が起動不能になる。
#     ここで qr_seed にも migrate を当ててスキーマを揃える。**種のデータ
#     (showcase) は触らない** — pending が無ければ "No pending migrations" で
#     no-op なので、コードのみの更新でも安全に通る。
#
# 使い方 (doDeploy.sh と同じ引数をそのまま渡す):
#   ./doDeployDemo.sh [patch|minor|major | --no-version-up] [--send-compose.yml]
#   ./doDeployDemo.sh -h    (doDeploy.sh の説明を表示)
#
# 本番と同じ版でデモを配りたいときは --no-version-up を使う:
#   ./doDeploy.sh patch            # 本番: 版を上げて配る
#   ./doDeployDemo.sh --no-version-up   # デモ: 同じ版を再利用して配る
# doDeploy.sh は毎回版を上げるので、無印で続けて呼ぶと本番とデモで版がずれる。
# --no-version-up ならレジストリの同版イメージを再利用し、ビット単位で同一になる。
#
# 前提: vps2 の ~/qr-demo/ が配置済み (compose 2種 + .env。docs/39 §5)。
#
# 種の「中身」を変えたいとき (showcase を更新したとき) は、これとは別に種を
# 撮り直す (docs/40 §3)。このスクリプトが同期するのはスキーマだけ。
set -euo pipefail
cd "$(dirname "$0")"

REMOTE="${DEPLOY_REMOTE:-vps2}"
DEMO_DIR="${DEPLOY_REMOTE_DIR:-qr-demo}"
SEED_DB="qr_seed"
# 種同期用トンネルのローカルポート。doDeploy.sh 本体 (15432) と別にする
SEED_TUNNEL_PORT="${DEMO_SEED_TUNNEL_PORT:-15533}"

log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# -h/--help は doDeploy.sh の説明をそのまま見せて終える。ここで捕まえないと、
# doDeploy.sh がヘルプを出して 0 で返った後、種同期まで走ってしまう。
for arg in "$@"; do
  case "$arg" in
    -h|--help) exec ./doDeploy.sh -h ;;
  esac
done

# 1. 本体のデプロイ (デモのポート/ディレクトリを固定して doDeploy.sh を呼ぶ)。
#    版数up・ビルド・転送・live qr の migrate・app 再作成まではここが行う。
DEPLOY_REMOTE_DIR="$DEMO_DIR" DEPLOY_DB_PORT=5433 DEPLOY_APP_PORT=3100 \
  ./doDeploy.sh "$@"

# 2. 種 qr_seed のスキーマを live に揃える (migration の罠を塞ぐ)。
#    doDeploy.sh の migrate 手順と同じ作法 (SSH トンネル + prisma migrate deploy)
#    を、接続先 DB だけ qr_seed に変えて行う。
log "種 ($SEED_DB) のスキーマ同期 (SSH トンネル localhost:$SEED_TUNNEL_PORT 経由)"
REMOTE_PW="$(ssh "$REMOTE" "grep '^POSTGRES_PASSWORD=' '$DEMO_DIR/.env' | cut -d= -f2-")"
[ -n "$REMOTE_PW" ] || die "$REMOTE の $DEMO_DIR/.env から POSTGRES_PASSWORD を取得できない"
ENC_PW="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$REMOTE_PW")"

SEED_CTRL="$(mktemp -u "${TMPDIR:-/tmp}/qr-demo-seed-ssh.XXXXXX")"
cleanup() { ssh -S "$SEED_CTRL" -O exit "$REMOTE" 2>/dev/null || true; }
trap cleanup EXIT
ssh -M -S "$SEED_CTRL" -f -N \
  -L "127.0.0.1:${SEED_TUNNEL_PORT}:127.0.0.1:5433" \
  -o ExitOnForwardFailure=yes "$REMOTE"

SEED_DB_URL="postgresql://qr:${ENC_PW}@127.0.0.1:${SEED_TUNNEL_PORT}/${SEED_DB}"
DATABASE_URL="$SEED_DB_URL" npx prisma migrate deploy

# 種の PGroonga を先に直す。**読むだけなら要らないが、書くには要る。**
#
# 種は `createdb -T qr` (テンプレート複製) で撮るので、Groonga の内部構造が
# 壊れた状態で生まれる (reseedDemo.sh §3/4 と同じ罠)。壊れた索引のまま
# items を UPDATE すると
#   pgroonga: PGrnLookupWithSize: object isn't found: <Sources…>
# で落ちる — 索引は行を書き換えるたびに更新されるため。
#
# 以前ここには「種の索引は直さない (live 側を REINDEX するので影響しない)」と
# 書いてあった。読む一方だった頃は本当だったが、下の派生列の埋め直しで
# **種へ書く**ようになったので直す必要ができた。
echo "--- 種の PGroonga を REINDEX (壊れた索引のままでは UPDATE が落ちる)"
ssh "$REMOTE" "cd '$DEMO_DIR' && docker compose exec -T db \
  psql -U qr -d $SEED_DB -c 'REINDEX DATABASE $SEED_DB'" </dev/null

# 種の派生列も埋め直す (docs/63-タイトル順計画.md §4)。
#
# **live 側だけ直しても毎時のリセットで巻き戻る。** reseedDemo.sh は
# `createdb -T qr_seed qr` で種を丸ごと複製するので、種の title が '' のままだと
# 1 時間後の live も '' に戻り、「タイトル順」が番号順にしか見えなくなる。
# スキーマ同期と同じ理由 (§ 冒頭 2.) で、ここに置くのがいちばん忘れない。
echo "--- 種の見出しを切り出し直す"
DATABASE_URL="$SEED_DB_URL" npx tsx scripts/backfillTitles.ts

# ここで直した種の索引は、次の reseedDemo.sh の createdb -T でまた壊れる。
# それでよい — あちらは複製の直後に live を REINDEX するので、live は健全に
# 保たれる (docs/39 §6-2)。ここの REINDEX は「この後の UPDATE を通すため」。

log "デモのデプロイ + 種のスキーマ同期 完了"
