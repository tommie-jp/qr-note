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
# 第 2 弾の高速化 (docs/80-デプロイ再高速化計画.md)。約 110 秒 → 約 30 秒。
#   - 依存レイヤーは版を潰した写し (.deps/) から入れる。素の package.json だと
#     doVersion.sh が版を上げるたびに層が無効化され、依存が変わっていないのに
#     npm ci が毎回走っていた (20.7 秒)。生成は scripts/writeDepsManifest.mjs。
#   - Dockerfile 側で public と静的フォントを「毎回変わる層」から追い出した。
#     毎デプロイの転送が 122.8MB → 約 15MB になる。
#   - lint / test / ビルドを並列で流し、全部通ってから push する。
#
# 第 3 弾の高速化 (docs/80-デプロイ再高速化計画.md §9)。約 42 秒 → 約 30 秒。
#   - **push を並列の窓に畳んだ。** ビルドは 1 回だけ走らせ、その場で
#     staging タグとしてレジストリへ送る。検査が全部通ったら、staging の
#     manifest を v$VERSION にも張って公開する (promote_tag)。層の転送は
#     済んでいるので昇格は manifest 1 枚の PUT = 1 秒未満。
#     以前は「cacheonly で建てる → 通ったら push 用にもう一度建てる」の
#     2 回ビルドで、2 回目の export + 転送 7 秒が検査の後ろに直列で付いていた。
#     ビルドが 1 回になったので、**push されるイメージは検査した木そのもの**に
#     なる (以前は 2 回目の `COPY . .` が新しい木を拾いうるのが穴だった)。
#   - 型検査を next build から出し、4 本目のレーンにした (next.config.ts の
#     typescript.ignoreBuildErrors + `npm run typecheck`)。ビルドの中では
#     単スレッドの 4.7 秒が直列に積まれていたが、外に出せば他のレーンの裏に隠れる。
#   - 10 秒級のテストを別ファイルへ分けた。vitest はファイル単位で並列化するので、
#     1 ファイルに重いものが同居しているとそこがテスト全体の所要になる。
#
# 最後に**区間ごとの処理時間**を出す。次に「遅い」と感じたとき、どこが遅いのかを
# 推測しないで済ませるため。
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
#   ./doDeploy.sh [patch|minor|major | --no-version-up] [--demo] [--send-compose.yml]
#                                                          (版指定の省略時: patch)
#   ./doDeploy.sh -h                                        (この説明を表示)
#
#   --demo  デモインスタンス (qr-demo) へ配る。
#
#     デモスタックの接続先を一括で固定する: リモートディレクトリ qr-demo、
#     migrate 先の DB ポート 5433、ヘルスチェック先の app ポート 3100。
#     **app ポートが 3000 のままだと本番 app を叩いて誤って成功と判定する**ため、
#     手打ちの env ではなくこの旗で配ること (env を明示すればそちらが勝つ)。
#
#     **既定で版を上げない** (--no-version-up 相当)。デモは本番と同じ版を配るのが
#     通常の運用なので、既定側をそちらに寄せてある。デモだけ版を上げたいときは
#     patch|minor|major を明示する。
#
#       ./doDeploy.sh patch      # 本番: 版を上げて配る
#       ./doDeploy.sh --demo     # デモ: 同じ版を再利用して配る
#
#     さらに手順 6 で**種 qr_seed にも migrate を当てる** (docs/39-デモ公開計画.md
#     §6-3)。live の qr だけ新スキーマにすると、種は旧スキーマのまま残り、次の
#     毎時リセット (`createdb -T qr_seed qr`) がスキーマを巻き戻して app が起動
#     不能になる。**種のデータ (showcase) は触らない** — pending が無ければ
#     "No pending migrations" で no-op なので、コードのみの更新でも安全に通る。
#     種の「中身」を変えたいときは別途 docs/40 §3 で撮り直す。
#
#   --no-version-up  版を上げず、現行 package.json の版をそのまま配る。
#
#     本番→デモを同じ版で配るための経路 (--demo では既定でこの動きになる)。
#     doDeploy.sh は毎回 doVersion.sh で版を上げるので、本番の後にデモを無印で
#     呼ぶと版がずれる。版を据え置けば、直前に本番へ配った版をそのまま載せられる。
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
# 環境変数で上書き可能 (括弧内は 既定 / --demo 時の既定):
#   DEPLOY_REMOTE          ssh 接続先 (default: vps2)
#   DEPLOY_REMOTE_DIR      リモートの compose ディレクトリ ($HOME 相対,
#                          default: 41-QR-search/qr-search / --demo: qr-demo)
#   DEPLOY_TUNNEL_PORT     マイグレーション用トンネルのローカルポート (default: 15432)
#   DEPLOY_DB_PORT         マイグレーション先の **リモート側** DB ポート (default: 5432 / --demo: 5433)
#   DEPLOY_APP_PORT        ヘルスチェックで叩くリモート側 app ポート (default: 3000 / --demo: 3100)
#   DEPLOY_REGISTRY_PORT   レジストリ転送用トンネルのローカルポート (default: 15000)
#   DEPLOY_REGISTRY_REMOTE_PORT リモート registry:2 の待受ポート (default: 5000)
#
# デモは compose.demo.yaml + デモ .env が配置済みの前提 (docs/39-デモ公開計画.md §5)。
# レジストリは本番・デモで共用する (イメージ名が同じなのでそのまま両対応)。
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "usage: $0 [patch|minor|major | --no-version-up] [--demo] [--send-compose.yml]" >&2
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
DEMO=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) help ;;
    --send-compose.yml) SEND_COMPOSE=1 ;;
    --no-version-up) NO_VERSION_UP=1 ;;
    --demo) DEMO=1 ;;
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
# --demo は既定で版を据え置く。デモには本番と同じ版を配るのが通常の運用で、
# 上げ幅を明示したときだけ (デモ単独のリリース) 版を上げる
if [ "$DEMO" = 1 ] && [ -z "$BUMP" ]; then NO_VERSION_UP=1; fi
BUMP="${BUMP:-patch}"

REMOTE="${DEPLOY_REMOTE:-vps2}"
TUNNEL_PORT="${DEPLOY_TUNNEL_PORT:-15432}"
# 接続先 (compose ディレクトリ / migrate 先 DB ポート / ヘルスチェックの app ポート)。
# 既定 (41-QR-search/qr-search / 5432 / 3000) は本番、--demo は別スタックの値。
# **デモで app ポートが 3000 のままだと、本番 app を叩いて誤って成功と判定する**
# ため、3 点をまとめて旗で切り替える (env を明示すればそちらが勝つ)。
if [ "$DEMO" = 1 ]; then
  REMOTE_DIR="${DEPLOY_REMOTE_DIR:-qr-demo}"
  REMOTE_DB_PORT="${DEPLOY_DB_PORT:-5433}"
  APP_PORT="${DEPLOY_APP_PORT:-3100}"
  SEED_DB="qr_seed"       # 毎時リセットの種 DB (手順 6 でスキーマを揃える)
else
  REMOTE_DIR="${DEPLOY_REMOTE_DIR:-41-QR-search/qr-search}"
  REMOTE_DB_PORT="${DEPLOY_DB_PORT:-5432}"
  APP_PORT="${DEPLOY_APP_PORT:-3000}"
fi
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
# 検査が通る前のイメージを置いておくタグ。**版タグ (v0.0.0 形式) にしないこと** —
# --no-version-up の再利用経路と registryGc.sh はどちらも `^v[0-9]` で版を拾うので、
# 検査に落ちたイメージが「配れる版」として見えてしまう。
# 毎デプロイ上書きするので溜まらない (本番・デモが同じレジストリを共有するが、
# 2 つを同時に走らせない限り混ざらない)。
STAGING_TAG="staging"
HEALTH_URL="http://127.0.0.1:${APP_PORT}/"
HEALTH_RETRIES=30

log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# 区間ごとの所要時間を控え、最後にまとめて出す (docs/80-デプロイ再高速化計画.md §6)。
# 「デプロイが遅い」と感じたときに、どこが遅いのかを推測しないで済ませるため。
# 失敗して落ちたときも (そこまでの分を) 出す — どこで待たされたかは失敗時こそ知りたい。
DEPLOY_T0="$(date +%s)"
STEP_T0="$DEPLOY_T0"
STEP_NAMES=()
STEP_SECS=()

step_done() {
  local now
  now="$(date +%s)"
  STEP_NAMES+=("$1")
  STEP_SECS+=("$((now - STEP_T0))")
  STEP_T0="$now"
}

# 秒を先に置くのは桁が揃うから。ラベルを %-Ns で揃えると、日本語は 1 文字 3 バイトの
# ため printf のバイト数勘定とずれて列が崩れる
print_timing() {
  [ "${#STEP_NAMES[@]}" -gt 0 ] || return 0
  local i
  echo ""
  echo "==> 処理時間"
  for i in "${!STEP_NAMES[@]}"; do
    printf '    %5ds  %s\n' "${STEP_SECS[$i]}" "${STEP_NAMES[$i]}"
  done
  printf '    %5ds  %s\n' "$(($(date +%s) - DEPLOY_T0))" "合計"
}

# レジストリ (トンネル越しの 127.0.0.1:$REGISTRY_PORT) の API 入口と、
# manifest を取りに行くときの Accept。buildx は --provenance=false で
# OCI image manifest を push するので、そちらを先に挙げる (index 系は将来
# 多プラットフォームにしたときのため。今は返ってこない)。
REG_API="http://127.0.0.1:${REGISTRY_PORT}/v2/qr-search-app"
MANIFEST_ACCEPT=(
  -H 'Accept: application/vnd.oci.image.manifest.v1+json'
  -H 'Accept: application/vnd.docker.distribution.manifest.v2+json'
  -H 'Accept: application/vnd.oci.image.index.v1+json'
  -H 'Accept: application/vnd.docker.distribution.manifest.list.v2+json'
)

# 指定タグの manifest があるか。
registry_has_tag() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "${MANIFEST_ACCEPT[@]}" \
    "${REG_API}/manifests/$1" 2>/dev/null || echo 000)"
  [ "$code" = "200" ]
}

# 指定タグが指す manifest のダイジェスト (無ければ空)。昇格の確認に使う。
manifest_digest() {
  curl -fsS -I "${MANIFEST_ACCEPT[@]}" "${REG_API}/manifests/$1" 2>/dev/null \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2}' || true
}

# staging タグが指す manifest を、別のタグ名からも引けるようにする (= 公開)。
#
# **層は 1 バイトも動かない。** レジストリは blob を内容で持ち、タグは manifest への
# 別名でしかないので、同じ manifest を PUT し直すだけで新しいタグが生える。
# これがあるおかげで「ビルドと push は検査と並列に済ませ、通ったものだけ公開する」
# が成り立つ (以前は公開のためだけに 2 回目のビルドと 7 秒の転送をしていた)。
#
# GET した本文を**そのまま**送り返すのが肝。整形し直すとダイジェストが変わり、
# 同じイメージなのに別物として層が再アップロードされる。
promote_tag() {
  local from="$1" to="$2" body headers ctype from_digest to_digest
  body="$LOG_DIR/manifest.json"
  headers="$LOG_DIR/manifest.headers"

  curl -fsS -o "$body" -D "$headers" "${MANIFEST_ACCEPT[@]}" \
    "${REG_API}/manifests/${from}" \
    || die "レジストリから ${from} の manifest を取得できない"

  # PUT の Content-Type は取得したものと同じでなければならない
  # (registry は manifest の mediaType と突き合わせる)
  ctype="$(awk -F': ' 'tolower($1)=="content-type"{print $2}' "$headers" | tr -d '\r' | tail -1)"
  [ -n "$ctype" ] || die "${from} の manifest の Content-Type が取れない"

  curl -fsS -X PUT -H "Content-Type: ${ctype}" --data-binary "@${body}" -o /dev/null \
    "${REG_API}/manifests/${to}" \
    || die "manifest を ${to} として登録できない"

  # 同じ manifest を指しているか確かめる。**ここが違うと配るものが変わる**のに、
  # 後ろの pull は成功してしまう (別のイメージが取れるだけなので)
  from_digest="$(manifest_digest "$from")"
  to_digest="$(manifest_digest "$to")"
  [ -n "$to_digest" ] && [ "$from_digest" = "$to_digest" ] \
    || die "タグ昇格の結果が一致しない (${from}=${from_digest:-取得不可} / ${to}=${to_digest:-取得不可})"
}

# 作業ツリー (= ビルドコンテキスト) の指紋。手順 3/8 の入口と、公開 (4/8) の直前で
# 採り、**ずれていたら配らずに落とす**ために使う。
#
# なぜ要るか: 3/8 の 4 本 (lint / typecheck / test / ビルド) は**それぞれが自分の
# 都合で作業ツリーを読む**。ビルドは入口で 1 度読み切るが、lint と test は約 25 秒
# かけて少しずつ読む。この間に保存が入ると、「イメージに焼かれた内容」と
# 「検査が見た内容」が食い違い、**誰も見ていないコードが本番へ出る**。しかも版も
# ログも「通った」ように見えるので、後から気づく手掛かりが残らない。
# 指紋が動いていたら公開を諦めるのが唯一安い。
#
# 以前は「2 回目のビルドが新しい木を拾う」ほうが主な穴だった (docs/80 §8-3)。
# ビルドを 1 回に畳んだ今もこの照合は残す — 上のとおり、検査側が動いた木を
# 読んでしまう筋はそのまま残っているため。
#
# 見るもの:
#   - HEAD          … 途中で checkout / commit されても気づけるように
#   - git status    … 追加・削除・改名 (中身が同じでも並びが変わる)
#   - 変更・未追跡ファイルの中身 … 名前だけでは「保存し直し」を拾えない
# gitignore された生成物 (.deps/ や copy:assets が作る public/ の wasm・モデル群) は
# 見ていない。あれらはこのスクリプト自身かビルドが作るもので、デプロイ中に人が
# 書き換える類ではない (そこまで見ると 188MB を毎回ハッシュする羽目になる)。
context_fingerprint() {
  {
    git rev-parse HEAD
    git status --porcelain
    # ハッシュ中に消えたファイル (エディタの一時ファイル等) で sha256sum が
    # 落ちても指紋は採り続ける。ここで死ぬ理由はない — 中身が動いたなら
    # 呼び出し側の比較が弾く
    git ls-files --modified --others --exclude-standard -z \
      | xargs -0 --no-run-if-empty sha256sum 2>/dev/null || true
  } | sha256sum | cut -d' ' -f1
}

# SSH は ControlMaster で 1 本に束ね、全 ssh/scp で使い回す (毎回のハンドシェイクを省く)。
# レジストリ転送トンネルも同じ master に載せ、終了時にまとめて閉じる。
SSH_CTRL="$(mktemp -u "${TMPDIR:-/tmp}/qr-deploy-ssh.XXXXXX")"
SSH() { ssh -S "$SSH_CTRL" "$@"; }
SCP() { scp -o "ControlPath=$SSH_CTRL" "$@"; }
# 3/8 を並列で走らせるあいだ、混ざらないよう各コマンドの出力を退避する置き場
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qr-deploy-logs.XXXXXX")"
cleanup() {
  ssh -S "$SSH_CTRL" -O exit "$REMOTE" 2>/dev/null || true
  rm -rf "$LOG_DIR"
  print_timing
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
step_done "0/8 SSH + レジストリ疎通"

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
step_done "1/8 APP_ENV 確認"

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
step_done "2/8 バージョン決定"
log "デプロイ対象: v$VERSION"

if [ "$REUSE" = 1 ]; then
  log "3/8 lint + typecheck + test + ビルド — スキップ (既存イメージを再利用)"
  log "4/8 タグ公開 — スキップ (v$VERSION は既にレジストリにある)"
  echo "注意: 配るのは v$VERSION を push した時点のイメージ。手元の未コミット変更は含まれない"
else
  # Dockerfile の依存レイヤーが読む .deps/ (版を潰した package.json の写し) を作る。
  # これがあるおかげで、版を上げても npm ci の層はキャッシュに載ったままになる
  # (docs/80-デプロイ再高速化計画.md §S1)
  node scripts/writeDepsManifest.mjs

  # host ネットワークの buildx ビルダーを用意する (無ければ作る)。
  # これが無いと push 先の 127.0.0.1 トンネルにビルダーが届かない。
  # 並列に入る前に済ませておく (ビルダー作成が 2 重に走らないように)。
  if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    log "buildx ビルダー ($BUILDER) を作成"
    docker buildx create --name "$BUILDER" --driver docker-container \
      --driver-opt network=host >/dev/null
  fi

  # lint / typecheck / test / ビルドは互いに独立なので同時に流す (docs/80 §S4・§9)。
  # 直列だと lint 8s + typecheck 2s + test 10s がまるまるビルドの前に積まれる。
  #
  # **ビルドはここで push まで済ませる。ただし staging タグへ。**
  # 公開用の v$VERSION に張り替えるのは 4 本とも通った後 (promote_tag)。
  # こうする理由が 2 つある:
  #   - 転送 (7 秒) が検査の裏に隠れる。以前は「cacheonly で建てて、通ったら
  #     push 用にもう一度建てる」で、2 回目の export + 転送が後ろに直列で付いていた。
  #   - **push されるイメージが、検査した木そのものになる。** 2 回建てていた頃は
  #     2 回目の `COPY . .` が新しい木を拾いえた (docs/80 §8-3)。
  # いきなり v$VERSION へ push しないのは、テストが落ちた版がレジストリに残ると
  # --no-version-up の再利用経路がそれを拾ってしまうため。staging タグは
  # 毎デプロイ上書きされるので溜まらない (中身が同じなら v$VERSION と同一の
  # manifest を指すだけで、blob も増えない)。
  # ただし**検査に落ちた回のぶんは層が残る** (約 14.5MB)。上書きで参照されなく
  # なった manifest を registryGc.sh は消さないため — 気になったら
  # `registry garbage-collect` に --delete-untagged を足す (docs/80 §9-1)。
  #
  # 出力はログへ退避して、待ち合わせた後にまとめて出す (同時に書くと混ざって読めない)。
  #
  # 指紋はジョブを起こす**直前**に採る。ここから公開までが「検査した木」で
  # なければならない区間 (詳細は context_fingerprint の説明)。
  #
  # git 管理下でないと指紋はただの定数になり、照合が**黙って効かなくなる**ので
  # 先に確かめる。デプロイは doVersion.sh も git を前提にしているため制約は増えない
  git rev-parse --git-dir >/dev/null 2>&1 \
    || die "git 管理下ではないため、ビルド中に作業ツリーが動いても検出できない。
     このスクリプトは git チェックアウトの中から実行すること"
  CONTEXT_FP="$(context_fingerprint)"
  log "3/8 lint + typecheck + test + イメージビルド (並列)"
  echo "    4 つ同時に実行中。出力は完了後にまとめて出す..."
  npm run lint >"$LOG_DIR/lint.log" 2>&1 &
  LINT_PID=$!
  # 型検査は next build から外してある (next.config.ts の ignoreBuildErrors)。
  # ここが唯一の型の門なので、落ちたら配らない
  npm run typecheck >"$LOG_DIR/typecheck.log" 2>&1 &
  TYPE_PID=$!
  npm test >"$LOG_DIR/test.log" 2>&1 &
  TEST_PID=$!
  # rewrite-timestamp で全レイヤーの mtime を BUILD_EPOCH に固定するため、
  # 中身が同じレイヤーは push 時に「既に存在」で飛ぶ。
  # registry.insecure=true は 127.0.0.1 の平文レジストリ (トンネル越し) を許すため。
  SOURCE_DATE_EPOCH="$BUILD_EPOCH" docker buildx build --builder "$BUILDER" \
    --provenance=false --sbom=false \
    --output "type=image,name=${REG_LOCAL}:${STAGING_TAG},push=true,rewrite-timestamp=true,registry.insecure=true" \
    . >"$LOG_DIR/build.log" 2>&1 &
  BUILD_PID=$!

  # **set -e はバックグラウンドジョブの失敗を拾わない。** wait の戻り値を必ず見る。
  # 1 つ落ちても残りを待ってから報告する (2 つ同時に落ちているときに片方しか
  # 見えないと、直して再実行してまた落ちる、を繰り返す羽目になる)
  FAILED=""
  wait "$LINT_PID"  || FAILED="$FAILED lint"
  wait "$TYPE_PID"  || FAILED="$FAILED typecheck"
  wait "$TEST_PID"  || FAILED="$FAILED test"
  wait "$BUILD_PID" || FAILED="$FAILED build"

  echo "--- lint";      cat "$LOG_DIR/lint.log"
  echo "--- typecheck"; cat "$LOG_DIR/typecheck.log"
  echo "--- test";      cat "$LOG_DIR/test.log"
  echo "--- build";     cat "$LOG_DIR/build.log"

  [ -z "$FAILED" ] || die "失敗:${FAILED} (上の出力を確認すること)"

  # **4 本が通ったのは「3/8 の入口の木」に対して**。lint と test はその後も
  # 20 秒かけて木を読み続けるので、途中で保存が入っていたら「イメージに焼かれた
  # 内容」と「検査が見た内容」が食い違う。指紋が動いていたら公開しない。
  CONTEXT_FP_NOW="$(context_fingerprint)"
  if [ "$CONTEXT_FP" != "$CONTEXT_FP_NOW" ]; then
    # 案内する再実行コマンドは呼ばれ方に合わせる。`[ ] && VAR=…` と書くと
    # 偽のとき AND リスト全体が 1 を返し、set -e がここでスクリプトを殺す
    RERUN="./doDeploy.sh --no-version-up"
    if [ "$DEMO" = 1 ]; then RERUN="$RERUN --demo"; fi
    die "lint + typecheck + test + ビルド中に作業ツリーが変わった (${CONTEXT_FP:0:12} → ${CONTEXT_FP_NOW:0:12})。
     このまま公開すると、**検査と食い違う内容のイメージ**が本番へ出る
     (イメージは 3/8 入口の木、lint / test が見たのは動いた後の木)。
     配布を中止した。変更を確定させてから、版を据え置いて配り直すこと:
       $RERUN
     (v$VERSION はまだ公開していないので、据え置きでもビルドし直しになる)"
  fi
  step_done "3/8 lint + typecheck + test + ビルド (並列)"

  # staging の manifest を v$VERSION からも引けるようにする = 公開。
  # 層は上の push で着地済みなので、ここは manifest 1 枚の PUT で終わる。
  log "4/8 v${VERSION} として公開 (${STAGING_TAG} → v${VERSION})"
  promote_tag "$STAGING_TAG" "v$VERSION"
  echo "OK: ${REG_LOCAL}:v${VERSION}"
  step_done "4/8 タグ公開"
fi

# リモートは自分の localhost のレジストリからダイジェスト一致で pull し、compose が
# 参照するタグ (qr-search-app:latest) に付け替える。compose.yaml は無変更でよい。
log "5/8 $REMOTE でイメージ取得 + タグ付け"
SSH "$REMOTE" "docker pull '${REG_REMOTE}:v${VERSION}' \
  && docker tag '${REG_REMOTE}:v${VERSION}' '$IMAGE'"
step_done "5/8 イメージ取得 + タグ付け"

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

# 見出しの派生列を切り出し直す (docs/63-タイトル順計画.md §4)。
#
# **忘れると「タイトル順」が全件同着 = 番号順にしか見えない。** 列を足す
# マイグレーションは既存行を '' のまま置き、'' は NULLS LAST で末尾へ回るため、
# 並べ替えの効かない一覧が黙って出る。
#
# タスク数と同じく冪等で、値が合っている行は書かない (598 件で 1 秒未満) ので
# 毎回流す。派生列を更新しない経路 (Ver1 取り込み) で狂っても次のデプロイで直る。
echo "--- 見出しの派生列を切り出し直す"
DATABASE_URL="$REMOTE_DB_URL" npx tsx scripts/backfillTitles.ts

# デモは live の qr を migrate しただけでは足りない。種 qr_seed が旧スキーマのまま
# 残り、次の毎時リセット (`createdb -T qr_seed qr`) がスキーマを巻き戻して app が
# 起動不能になる (docs/39-デモ公開計画.md §6-3)。ここで種にも同じ migration を当てる。
# pending が無ければ "No pending migrations" で no-op なので、コードのみの更新でも
# 安全に通る。種は live と同じ Postgres の別 DB なので、上のトンネルを DB 名だけ
# 変えて使い回す。
#
# **触るのはスキーマと派生列だけ** — 種のノート (showcase の中身) は書き換えない。
# 派生列 (title / task_*) は本文から機械的に切り出したキャッシュなので、
# 埋め直しても「見せている内容」は変わらない。
if [ "$DEMO" = 1 ]; then
  SEED_DB_URL="postgresql://qr:${ENCODED_PW}@127.0.0.1:${TUNNEL_PORT}/${SEED_DB}"

  echo "--- 種 ($SEED_DB) のスキーマを live に揃える"
  DATABASE_URL="$SEED_DB_URL" npx prisma migrate deploy

  # 種の PGroonga を先に直す。**読むだけなら要らないが、書くには要る。**
  #
  # 種は `createdb -T qr` (テンプレート複製) で撮るので、Groonga の内部構造が
  # 壊れた状態で生まれる (docs/39-デモ公開計画.md §6-2 と同じ罠)。壊れた索引の
  # まま items を UPDATE すると
  #   pgroonga: PGrnLookupWithSize: object isn't found: <Sources…>
  # で落ちる — 索引は行を書き換えるたびに更新されるため。
  #
  # ここには以前「種の索引は直さない (毎時の reseedDemo.sh が live 側を
  # REINDEX するので影響しない)」と書いてあった。**読む一方だった頃は本当
  # だったが、下で種へ書くようになったので成り立たない。** 退役した
  # doDeployDemo.sh が同じ理由でこの注意書きを撤回していたのに、
  # doDeploy.sh へ畳むときに移し損ねていた。
  #
  # </dev/null … docker compose exec -T は繋いだ stdin を食い尽くすので、
  # 塞がないと後続のコマンドが黙って実行されなくなる
  echo "--- 種の PGroonga を REINDEX (壊れた索引のままでは UPDATE が落ちる)"
  SSH "$REMOTE" "cd '$REMOTE_DIR' && docker compose exec -T db \
    psql -U qr -d $SEED_DB -c 'REINDEX DATABASE $SEED_DB'" </dev/null

  # 種の派生列も埋め直す (docs/63-タイトル順計画.md §4)。
  #
  # **live 側だけ直しても毎時のリセットで巻き戻る。** reseedDemo.sh は
  # `createdb -T qr_seed qr` で種を丸ごと複製するので、種の title が '' のままだと
  # 1 時間後の live も '' に戻り、「タイトル順」が全件同着 = 番号順にしか
  # 見えなくなる。スキーマ同期をここに置いているのと同じ理由で、忘れないよう
  # 隣に並べる。
  echo "--- 種の見出しを切り出し直す"
  DATABASE_URL="$SEED_DB_URL" npx tsx scripts/backfillTitles.ts

  # タスク数も同じ理由で埋め直す (live 側は上で流している)。派生列を 1 つだけ
  # 直しても、もう片方が巻き戻れば結局ちぐはぐになる
  echo "--- 種のタスク数を数え直す"
  DATABASE_URL="$SEED_DB_URL" npx tsx scripts/backfillTaskCounts.ts

  # ここで直した種の索引は、次の reseedDemo.sh の createdb -T でまた壊れる。
  # それでよい — あちらは複製の直後に live を REINDEX するので live は健全に
  # 保たれる (docs/39 §6-2)。ここの REINDEX は「この後の UPDATE を通すため」
fi

SSH -O cancel -L "127.0.0.1:${TUNNEL_PORT}:127.0.0.1:${REMOTE_DB_PORT}" "$REMOTE" 2>/dev/null || true
step_done "6/8 マイグレーション + 派生列"

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
step_done "7/8 app コンテナ再作成"

log "8/8 ヘルスチェック ($REMOTE 上の $HEALTH_URL)"
for i in $(seq 1 "$HEALTH_RETRIES"); do
  status="$(SSH "$REMOTE" "curl -fsS -o /dev/null -w '%{http_code}' '$HEALTH_URL'" || true)"
  if [ "$status" = "200" ]; then
    echo "OK: HTTP $status"
    # 中間タグ (127.0.0.1:5000/...:vX) を外して溜めない。:latest は残るので影響なし。
    # その後 dangling を掃除する (前バージョンの :latest が浮く)。
    SSH "$REMOTE" "docker rmi '${REG_REMOTE}:v${VERSION}' >/dev/null 2>&1 || true; docker image prune -f" >/dev/null
    step_done "8/8 ヘルスチェック + 後片付け"
    log "デプロイ完了 (v$VERSION)"
    # 処理時間の内訳は EXIT trap の print_timing がこの後に出す
    exit 0
  fi
  echo "  waiting... ($i/$HEALTH_RETRIES, status=${status:-none})"
  sleep 2
done
die "ヘルスチェックが $HEALTH_RETRIES 回失敗した。$REMOTE で 'docker compose logs app' を確認すること"
