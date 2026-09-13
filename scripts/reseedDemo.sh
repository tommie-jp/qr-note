#!/usr/bin/env bash
# qr-demo インスタンスをテンプレート DB から初期状態へ戻す (docs/39-デモ公開計画.md §6)。
#
# ノート単位の TTL ではなく **DB ごと初期状態へ戻す**。消し忘れが構造的に
# 起きず、guest が書き溜めた添付 (bytea) も画像・音声ごと 1 発で消える。
# systemd timer (deploy/systemd/qr-demo-reseed.timer) から毎時呼ぶ想定。
#
# 対象 DB は隔離デモコンテナ内の `qr` (live) と `qr_seed` (種)。デモは
# 別スタック = 別 Postgres コンテナなので、本番の `qr` とは元から衝突しない
# (DB 名まで別にする必要はない。隔離はコンテナの層で足りる)。
#
# --- 種 (qr_seed) の作り方 (初回・撮り直し。docs/39 §6-1) ---
#   手元から scripts/doDemoSeedEdit.sh を使うのが楽 (docs/48):
#     ./doDemoSeedEdit.sh start   # 種の状態から編集を始める
#     ...ブラウザでショーケースノートを作り込む...
#     ./doDemoSeedEdit.sh commit  # いまの live を種として確定
#   手で撮るなら、この dir で app を止めてから:
#        docker compose exec -T db createdb -U qr -T qr qr_seed
#      (撮り直すときは先に `dropdb -U qr qr_seed`)
#
# --- 罠: migration を当てたら種も作り直す (docs/39 §6-3) ---
#   prisma migrate deploy は live の `qr` にしか当たらない。**種 `qr_seed` は
#   古いスキーマのまま**なので、次の毎時リセットで migration 前へ巻き戻り、
#   app が起動できなくなる。新しい migration を含むデプロイをデモに当てたら、
#   直後に上の手順で種を作り直すこと。
#
# 使い方:
#   ./reseedDemo.sh            # 再シードする
#   DEMO_DIR=/path ./reseedDemo.sh
#
# 環境変数:
#   DEMO_DIR  compose のある dir (default: このスクリプトのある dir)
set -euo pipefail

# スクリプト自身のある場所を既定にする。~/qr-demo/ に置けばそこで動く
DEMO_DIR="${DEMO_DIR:-$(cd "$(dirname "$0")" && pwd)}"
DB_NAME="qr"
SEED_NAME="qr_seed"
DB_USER="qr"

# log / die を scripts/lib/log.sh から source しないのはわざと。このスクリプトだけは
# vps2 の ~/qr-demo/ に単体でコピーして systemd から動かす (deploy/systemd/) ので、
# リポジトリの scripts/lib/ がそこには無い
log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

cd "$DEMO_DIR" || die "DEMO_DIR に入れない: $DEMO_DIR"
[ -f compose.yaml ] || die "$DEMO_DIR に compose.yaml が無い (デモの compose dir を指すこと)"

# db コンテナ内で psql/createdb を叩く小道具 (systemd から呼ぶので -T)
db_exec() { docker compose exec -T db "$@"; }

log "1/4 種 ($SEED_NAME) の存在確認"
# 種が無いまま createdb -T すると失敗する。初回セットアップの未了を明確に伝える
seed_exists="$(db_exec psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${SEED_NAME}'" 2>/dev/null || true)"
if [ "$seed_exists" != "1" ]; then
  die "テンプレート DB '${SEED_NAME}' が無い。先に種を作ること (このスクリプト冒頭 §6-1):
    docker compose exec -T db createdb -U ${DB_USER} -T ${DB_NAME} ${SEED_NAME}"
fi
echo "OK: ${SEED_NAME} あり"

# app を止めてから DB を差し替える。template コピー (createdb -T) は
# source/target に接続が 1 本でもあると失敗するため、pg_terminate で競走するより
# app を止めるほうが固い。dropdb --force は healthcheck (pg_isready) の
# 取りこぼし接続まで切って、確実に落とす保険
log "2/4 app 停止"
docker compose stop app

log "3/4 ${DB_NAME} を ${SEED_NAME} から作り直す + PGroonga を REINDEX"
db_exec dropdb --if-exists --force -U "$DB_USER" "$DB_NAME"
db_exec createdb -U "$DB_USER" -T "$SEED_NAME" "$DB_NAME"
# **createdb -T (テンプレート複製) は PGroonga の Groonga 内部構造を壊す。**
# インデックスは残るが検索で "pgroonga: ... object isn't found" になり、
# 全文検索 (memo &@~ …、PGroonga が乗っ取る LIKE も) が死ぬ。PGroonga 公式が
# TEMPLATE 複製後の REINDEX を要求している。app を止めている今のうちに直す。
# タグ検索 (配列列) は無事なので、REINDEX を忘れると「タグは効くが全文は死ぬ」
# 形で静かに壊れる (気づきにくい)
db_exec psql -U "$DB_USER" -d "$DB_NAME" -c "REINDEX DATABASE ${DB_NAME}"

log "4/4 app 起動"
docker compose start app

log "再シード完了 (${DB_NAME} を初期状態へ戻した)"
