#!/usr/bin/env bash
# qr-search を vps2 へデプロイする。
#
# 前提 (docs/03-移行計画.md の手順を自動化したもの):
#   - vps2 の ~/41-QR-search/qr-search/ に compose.yaml と .env が配置済み
#   - その .env に APP_ENV=production がある (無いと本番の画面がローカル扱いに
#     なるため、手順 1/8 で弾く)
#   - vps2 は空きメモリが少なくビルド不可のため、
#     イメージはローカルでビルドして vps2 上の私設レジストリ経由で転送する
#   - DB マイグレーションはランタイムイメージに prisma CLI が無いため、
#     SSH トンネル経由でローカルから prisma migrate deploy を実行する
#
# 転送はレジストリのレイヤー差分で行う (docs/41-デプロイ高速化.md)。
#   旧: docker save | gzip | ssh | docker load — 毎回イメージ全体 (631MB) を送っていた。
#   新: buildx で rewrite-timestamp を効かせて全レイヤーの mtime を固定日時に揃え、
#       SSH トンネル越しに vps2 の registry:2 へ push する。中身が変わらないレイヤー
#       (ベース + public の 188MB モデル群 + onnx 35MB) は「既に存在」で飛び、実際に
#       変わる .next の static/standalone (計 ~55MB 圧縮) だけが転送される。
#   rewrite-timestamp が要る理由: COPY 層の tar には親ディレクトリ app/ のエントリが
#   毎回のビルド時刻で入り、中身が同一でもレイヤーダイジェストが変わって全再送になる。
#   SOURCE_DATE_EPOCH + rewrite-timestamp で app/ を含む全 mtime を固定して再現性を得る。
#   host ネットワークの buildx ビルダーを使うのは、SSH トンネル (127.0.0.1) へ
#   push させるため (既定の docker-container ビルダーは別 netns でトンネルに届かない)。
#
# 初回のみ: vps2 に私設レジストリを設置する。
#   ./deploy/setupRegistry.sh
# 溜まった古いイメージの掃除:
#   ./deploy/registryGc.sh            (既定は dry-run)
#
# デプロイのたびに ./doVersion.sh でバージョンを必ず上げる。
# 画面フッターはビルド時に package.json の version を埋め込むため、
# バージョンアップはイメージビルドより前に行う。
#
# 使い方:
#   ./doDeploy.sh [patch|minor|major | --no-version-up] [--send-compose.yml]
#                                                          (版指定の省略時: patch)
#   ./doDeploy.sh -h                                        (この説明を表示)
#
#   --no-version-up  版を上げず、現行 package.json の版をそのまま配る。
#
#     本番→デモを同じ版で配るための経路。doDeploy.sh は毎回 doVersion.sh で版を
#     上げるので、ラッパ (doDeployDemo.sh) をそのまま続けて呼ぶと版がずれる。
#     デモ側を --no-version-up で呼べば、直前に本番へ配った版をそのまま載せられる。
#     レジストリに同版のイメージがあれば **ビルドも lint/test も飛ばして再利用**する
#     (本番と**ビット単位で同一**のイメージが載る)。無ければ版据え置きでビルドする。
#     注意: 再利用時に配られるのは「その版を push した時点のイメージ」で、手元の
#     未コミット変更は含まれない (同版=同一ビットを保証する仕様上の正しい挙動)。
#
#   --send-compose.yml  compose.yaml もリモートへ送る。
#
#     既定で送らないのは、リモートの compose.yaml が「配置済みの設定」であり、
#     毎回上書きすると手元と乖離していたときに黙って消してしまうため。
#     一方で**環境変数を足したときは送らないと反映されない** — 値を渡す
#     environment: の行は compose.yaml 側にあるので、.env だけ直しても
#     コンテナには届かず「設定したのに未設定と言われる」形で嵌まる
#     (docs/29-パスキー計画.md §12 で実際に踏んだ)。
#
# 環境変数で上書き可能:
#   DEPLOY_REMOTE          ssh 接続先 (default: vps2)
#   DEPLOY_REMOTE_DIR      リモートの compose ディレクトリ ($HOME 相対, default: 41-QR-search/qr-search)
#   DEPLOY_TUNNEL_PORT     マイグレーション用トンネルのローカルポート (default: 15432)
#   DEPLOY_DB_PORT         マイグレーション先の **リモート側** DB ポート (default: 5432)
#   DEPLOY_APP_PORT        ヘルスチェックで叩くリモート側 app ポート (default: 3000)
#   DEPLOY_REGISTRY_PORT   レジストリ転送用トンネルのローカルポート (default: 15000)
#   DEPLOY_REGISTRY_REMOTE_PORT リモート registry:2 の待受ポート (default: 5000)
#
# デモインスタンス (qr-demo) へのデプロイは、別スタックのポートに向けて:
#   DEPLOY_REMOTE_DIR=qr-demo DEPLOY_DB_PORT=5433 DEPLOY_APP_PORT=3100 ./doDeploy.sh
# (compose.demo.yaml + デモ .env は配置済みの前提。docs/39-デモ公開計画.md §5)
# レジストリは本番・デモで共用する (イメージ名が同じなのでそのまま両対応)。
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "usage: $0 [patch|minor|major | --no-version-up] [--send-compose.yml]" >&2
  echo "       $0 -h    (詳しい説明)" >&2
  exit 1
}

# -h: このスクリプト冒頭のコメント (先頭の #! を除く連続する # 行) をそのまま説明として出す。
# 説明の実体をコメントと二重に持たず、ヘッダ 1 箇所に集約するため。
help() {
  sed -n '2,/^set -euo pipefail$/ { /^#/ s/^# \{0,1\}//p }' "$0"
  exit 0
}

BUMP=""
NO_VERSION_UP=0
SEND_COMPOSE=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) help ;;
    --send-compose.yml) SEND_COMPOSE=1 ;;
    --no-version-up) NO_VERSION_UP=1 ;;
    patch|minor|major)
      # バージョンの上げ幅を 2 つ書かれたら、どちらの意図か決められない
      [ -z "$BUMP" ] || usage
      BUMP="$arg"
      ;;
    *) usage ;;
  esac
done
# 版を上げない指定と、上げ幅の指定は矛盾する
if [ "$NO_VERSION_UP" = 1 ] && [ -n "$BUMP" ]; then usage; fi
BUMP="${BUMP:-patch}"

REMOTE="${DEPLOY_REMOTE:-vps2}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-41-QR-search/qr-search}"
TUNNEL_PORT="${DEPLOY_TUNNEL_PORT:-15432}"
# マイグレーション先のリモート側 DB ポートと、ヘルスチェックの app ポート。
# 既定 (5432 / 3000) は本番。デモは別スタックの別ポート (5433 / 3100) を渡す。
# **デモで 3000 のままだと、本番 app を叩いて誤って成功と判定する**ので必須
REMOTE_DB_PORT="${DEPLOY_DB_PORT:-5432}"
# レジストリ転送用トンネル: ローカル $REGISTRY_PORT → リモート $REGISTRY_REMOTE_PORT。
# 本番・デモとも同じレジストリを共用するので、ここはスタックによらず既定でよい。
REGISTRY_PORT="${DEPLOY_REGISTRY_PORT:-15000}"
REGISTRY_REMOTE_PORT="${DEPLOY_REGISTRY_REMOTE_PORT:-5000}"
IMAGE="qr-search-app:latest"
BUILDER="qr-host"           # host ネットワークの buildx ビルダー名
# レイヤー再現性のための固定エポック (2024-01-01)。**デプロイ間で一定であることが肝**。
# 変えると全レイヤーの mtime がずれて一度だけ全再送になる (壊れはしない)。
BUILD_EPOCH="1704067200"
REG_LOCAL="127.0.0.1:${REGISTRY_PORT}/qr-search-app"
REG_REMOTE="127.0.0.1:${REGISTRY_REMOTE_PORT}/qr-search-app"
HEALTH_URL="http://127.0.0.1:${DEPLOY_APP_PORT:-3000}/"
HEALTH_RETRIES=30

log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# レジストリ (トンネル越しの 127.0.0.1:$REGISTRY_PORT) に指定タグの manifest があるか。
# buildx は --provenance=false で OCI image manifest を push するので Accept に含める。
registry_has_tag() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
    -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
    "http://127.0.0.1:${REGISTRY_PORT}/v2/qr-search-app/manifests/$1" 2>/dev/null || echo 000)"
  [ "$code" = "200" ]
}

# SSH は ControlMaster で 1 本に束ね、全 ssh/scp で使い回す (毎回のハンドシェイクを省く)。
# レジストリ転送トンネルも同じ master に載せ、終了時にまとめて閉じる。
SSH_CTRL="$(mktemp -u "${TMPDIR:-/tmp}/qr-deploy-ssh.XXXXXX")"
SSH() { ssh -S "$SSH_CTRL" "$@"; }
SCP() { scp -o "ControlPath=$SSH_CTRL" "$@"; }
cleanup() {
  ssh -S "$SSH_CTRL" -O exit "$REMOTE" 2>/dev/null || true
}
trap cleanup EXIT

log "0/8 SSH 多重接続 + レジストリトンネル確立 (127.0.0.1:${REGISTRY_PORT} → ${REMOTE}:${REGISTRY_REMOTE_PORT})"
ssh -M -S "$SSH_CTRL" -f -N -o ExitOnForwardFailure=yes \
  -L "127.0.0.1:${REGISTRY_PORT}:127.0.0.1:${REGISTRY_REMOTE_PORT}" "$REMOTE"

# レジストリの疎通を先に確認する。ビルドで時間を使う前に、設置忘れを弾く。
if ! curl -fsS "http://127.0.0.1:${REGISTRY_PORT}/v2/" >/dev/null 2>&1; then
  die "${REMOTE} の私設レジストリ (registry:2) に到達できない。
     初回は設置が必要 (一度きり):
       ./deploy/setupRegistry.sh
     (DEPLOY_REMOTE 等の環境変数は doDeploy.sh と共通)"
fi
echo "OK: レジストリ疎通"

# 非本番の画面はピンク + タイトル [LOCAL] になる (src/lib/appEnv.ts)。
# 判定は「APP_ENV=production を明示したときだけ本番」なので、リモートの .env に
# 書き忘れると本番が LOCAL 表示のまま公開されてしまう。ビルドで時間を使う前に弾く
log "1/8 デプロイ先の APP_ENV 確認"
REMOTE_APP_ENV="$(SSH "$REMOTE" "grep '^APP_ENV=' '$REMOTE_DIR/.env' | cut -d= -f2-")"
if [ "$REMOTE_APP_ENV" != "production" ]; then
  die "$REMOTE の $REMOTE_DIR/.env に APP_ENV=production がない (現在: ${REMOTE_APP_ENV:-未設定})。
     これが無いと本番の画面がローカル扱い (ピンク + [LOCAL]) になる。
     次を実行してから再デプロイすること:
       ssh $REMOTE \"echo APP_ENV=production >> $REMOTE_DIR/.env\""
fi
echo "OK: APP_ENV=production"

# 版を先に決める。--no-version-up なら現行版を据え置き、レジストリに同版が
# あればビルドも lint/test も飛ばして「その版そのもの」を再利用する。
# (版決定をビルド前に置くのは、再利用時に lint/test まで飛ばせるようにするため)
log "2/8 バージョン決定"
REUSE=0
if [ "$NO_VERSION_UP" = 1 ]; then
  VERSION="$(node -p "require('./package.json').version")"
  if registry_has_tag "v$VERSION"; then
    REUSE=1
    echo "OK: 版を据え置き。レジストリの v$VERSION を再利用する"
  else
    echo "OK: 版を据え置き (v$VERSION)。レジストリに未登録のためビルドする"
  fi
else
  ./doVersion.sh "$BUMP"
  VERSION="$(node -p "require('./package.json').version")"
  echo "OK: v$VERSION に更新 ($BUMP)"
fi
log "デプロイ対象: v$VERSION"

if [ "$REUSE" = 1 ]; then
  log "3/8 lint + test — スキップ (既存イメージを再利用)"
  log "4/8 イメージビルド + push — スキップ (v$VERSION は既にレジストリにある)"
  echo "注意: 配るのは v$VERSION を push した時点のイメージ。手元の未コミット変更は含まれない"
else
  log "3/8 lint + test"
  npm run lint
  npm test

  # host ネットワークの buildx ビルダーを用意する (無ければ作る)。
  # これが無いと push 先の 127.0.0.1 トンネルにビルダーが届かない。
  if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    log "buildx ビルダー ($BUILDER) を作成"
    docker buildx create --name "$BUILDER" --driver docker-container \
      --driver-opt network=host >/dev/null
  fi

  # ビルドとレジストリ push を 1 回で行う。rewrite-timestamp で全レイヤーの mtime を
  # BUILD_EPOCH に固定するため、中身が同じレイヤーは push 時に「既に存在」で飛ぶ。
  # registry.insecure=true は 127.0.0.1 の平文レジストリ (トンネル越し) を許すため。
  log "4/8 イメージビルド + レジストリ push (${REG_LOCAL}:v${VERSION})"
  SOURCE_DATE_EPOCH="$BUILD_EPOCH" docker buildx build --builder "$BUILDER" \
    --provenance=false --sbom=false \
    --output "type=image,name=${REG_LOCAL}:v${VERSION},push=true,rewrite-timestamp=true,registry.insecure=true" \
    .
fi

# リモートは自分の localhost のレジストリからダイジェスト一致で pull し、compose が
# 参照するタグ (qr-search-app:latest) に付け替える。compose.yaml は無変更でよい。
log "5/8 $REMOTE でイメージ取得 + タグ付け"
SSH "$REMOTE" "docker pull '${REG_REMOTE}:v${VERSION}' \
  && docker tag '${REG_REMOTE}:v${VERSION}' '$IMAGE'"

log "6/8 DB マイグレーション + 派生列の再計算 (SSH トンネル localhost:$TUNNEL_PORT 経由)"
REMOTE_PW="$(SSH "$REMOTE" "grep '^POSTGRES_PASSWORD=' '$REMOTE_DIR/.env' | cut -d= -f2-")"
[ -n "$REMOTE_PW" ] || die "$REMOTE の $REMOTE_DIR/.env から POSTGRES_PASSWORD を取得できない"
ENCODED_PW="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$REMOTE_PW")"

# 既に張ってある master にマイグレーション用のポート転送を追加し、済んだら外す。
SSH -O forward -L "127.0.0.1:${TUNNEL_PORT}:127.0.0.1:${REMOTE_DB_PORT}" "$REMOTE"
REMOTE_DB_URL="postgresql://qr:${ENCODED_PW}@127.0.0.1:${TUNNEL_PORT}/qr"
DATABASE_URL="$REMOTE_DB_URL" npx prisma migrate deploy

# タスク数の派生列を数え直す (docs/56-チェック検索計画.md §4)。
#
# **忘れると is:todo / is:done が静かに誤答する。** 列を足すマイグレーションは
# 既存行を 0 のまま置くので、`is:todo` は 0 件になり、その裏返しの `!is:todo` は
# **未チェックが残っているノートまで含めた全件**を返す。後者は「壊れている」
# ようには見えないぶん質が悪い。
#
# 冪等で、値が既に合っている行は書かない (588 件で 1 秒未満) ので毎回流してよい。
# むしろ毎回流すことで、派生列を更新しない経路 (Ver1 取り込み) で狂っても
# 次のデプロイで自然に直る。リモートにはソースが無いのでローカルから叩く
# (このトンネルは prisma migrate deploy が使うのと同じもの)。
echo "--- タスク数の派生列を数え直す"
DATABASE_URL="$REMOTE_DB_URL" npx tsx scripts/backfillTaskCounts.ts

SSH -O cancel -L "127.0.0.1:${TUNNEL_PORT}:127.0.0.1:${REMOTE_DB_PORT}" "$REMOTE" 2>/dev/null || true

# compose.yaml の転送は再作成の**直前**に置く。ここで送っておけば、続く
# up -d --force-recreate が新しい定義 (environment: など) で作り直す。
# 送ったのに再作成しない、という中途半端な状態を作らないための並び
if [ "$SEND_COMPOSE" = "1" ]; then
  log "7/8 compose.yaml 転送 + app コンテナ再作成"

  LOCAL_SUM="$(md5sum compose.yaml | cut -d' ' -f1)"
  REMOTE_SUM="$(SSH "$REMOTE" "md5sum '$REMOTE_DIR/compose.yaml' 2>/dev/null | cut -d' ' -f1" || true)"

  if [ "$LOCAL_SUM" = "$REMOTE_SUM" ]; then
    echo "OK: compose.yaml は同一 (転送を省略)"
  else
    # 上書きする前に控えを取る。手元と乖離した設定がリモートにあった場合、
    # 転送はそれを消す操作になるため。正本はこのリポジトリなので、
    # 控えは「直前の状態にすぐ戻せる」ためだけの 1 世代でよい。
    #
    # 初回 (リモートに何も無い) は控えを作らない。作れないのに
    # 「控えは .bak にある」と言うと、戻せると思って探す羽目になる
    if SSH "$REMOTE" "[ -f '$REMOTE_DIR/compose.yaml' ]"; then
      SSH "$REMOTE" "cp '$REMOTE_DIR/compose.yaml' '$REMOTE_DIR/compose.yaml.bak'"
      BACKUP_NOTE="前の内容は $REMOTE_DIR/compose.yaml.bak"
    else
      BACKUP_NOTE="リモートに既存の compose.yaml は無かった"
    fi
    SCP -q compose.yaml "$REMOTE:$REMOTE_DIR/compose.yaml"
    echo "OK: compose.yaml を転送 ($BACKUP_NOTE)"
  fi
else
  log "7/8 app コンテナ再作成"
fi

SSH "$REMOTE" "cd '$REMOTE_DIR' && docker compose up -d --no-build --force-recreate app"

log "8/8 ヘルスチェック ($REMOTE 上の $HEALTH_URL)"
for i in $(seq 1 "$HEALTH_RETRIES"); do
  status="$(SSH "$REMOTE" "curl -fsS -o /dev/null -w '%{http_code}' '$HEALTH_URL'" || true)"
  if [ "$status" = "200" ]; then
    echo "OK: HTTP $status"
    # 中間タグ (127.0.0.1:5000/...:vX) を外して溜めない。:latest は残るので影響なし。
    # その後 dangling を掃除する (前バージョンの :latest が浮く)。
    SSH "$REMOTE" "docker rmi '${REG_REMOTE}:v${VERSION}' >/dev/null 2>&1 || true; docker image prune -f" >/dev/null
    log "デプロイ完了 (v$VERSION)"
    exit 0
  fi
  echo "  waiting... ($i/$HEALTH_RETRIES, status=${status:-none})"
  sleep 2
done
die "ヘルスチェックが $HEALTH_RETRIES 回失敗した。$REMOTE で 'docker compose logs app' を確認すること"
