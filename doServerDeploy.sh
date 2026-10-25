#!/usr/bin/env bash
# qr-search のスタックを別の VPS へ引っ越す。手元 (WSL) から実行する。
# 既定は vps2 → vps1 の本番スタック。--demo でデモ (qr-demo) も同じ手順で運べる。
#
# 背景 (2026-10-24): vps2 の OS を上げ直すため、本番を一時的に vps1 へ移す
# (vps1 には kick-app が同居する)。vps2 へ戻すかは未定なので、--from / --to を
# 入れ替えれば逆向きにも使える作りにしてある。
#
# 運ぶもの:
#   - DB (pg_dump -Fc)。画像は images テーブルにあるので、これ 1 本でノートと画像が揃う
#   - git-notes volume (ノートの git 履歴。DB の外にある唯一の永続データ)
#   - 設定: compose.yaml / .env (デモは compose.demo.yaml / reseedDemo.sh も)。
#     **移行元に配置済みのものを運ぶ** — 手元のファイルではない (手元と乖離していても
#     いま動いている設定のまま移すため)
#   - イメージ: 移行元で動いているものを docker save | docker load でそのまま運ぶ。
#     本番とビット単位で同一になる (手元でビルドし直すと未配布の変更が混ざりうる)
#   - nginx の conf (deploy/nginx/<site>.conf) と Let's Encrypt の証明書一式
# 運ばないもの:
#   - レジストリの中身 (旧版の山)。移行先に空のレジストリを立て、今の版だけ入れる
#   - Server Action の暗号鍵 (手元 ~/.config/qr-note/ にあり、サーバには無い)
#
# DB とイメージは手元を経由して流す。ダンプ (と git-notes の tar) は backup/ に残るので、
# 移行直前の状態のバックアップを兼ねる (1 回で DB の大きさぶん手元のディスクを使う)。
#
# フェーズ (どれも冪等。途中で落ちたら同じコマンドで流し直せばよい):
#   check     両端の疎通・移行先の道具と空き (メモリ / ディスク / ポート)・版・DNS の現在値
#   prepare   移行先に設定を配置、レジストリ設置、イメージ転送、db 起動
#   sync      DB と git-notes を移行元 → 移行先へ複製し、件数と中身のハッシュで照合
#             --freeze を付けると先に移行元の app を止める (本番切替の直前に使う)
#   app       doDeploy.sh --no-version-up で移行先に app を立てる (運んだイメージを再利用)
#   edge      証明書と nginx の conf を入れ、curl --resolve で移行先を直接叩いて確かめる
#   cutover   A レコードの変更を待ち、反映を確かめ、配布先の控えを移行先へ切り替える
#   retire    移行元のスタックを止め、nginx から vhost を外す (データと証明書は消さない)
#   unfreeze  --freeze で止めた移行元の app を再開する (切替を取りやめるとき)
#   all       check → prepare → sync → app → edge (切替前の下ごしらえ。移行元は無停止)
#
# 本番切替の流れ:
#   ./doServerDeploy.sh all             # 前日まで: 下ごしらえ + リハーサル
#                                       #   (A レコードの TTL も 300 秒に下げておく)
#   ./doServerDeploy.sh sync --freeze   # 当日: 移行元の app を止めて最終同期
#   ./doServerDeploy.sh cutover         # A レコードを変え、反映を待つ
#   ./doServerDeploy.sh retire          # TTL×2 経過して落ち着いてから
#   (デモも運ぶときは同じ並びに --demo を付ける)
#
# 配布先の控え (scripts/lib/target.sh の deploy_host):
#   cutover の最後に ~/.config/qr-note/host-<prod|demo> を移行先に書き換える。
#   以後の ./doDeploy.sh などは何も付けずに新しいサーバへ配る。
#   **sync / prepare は「控え = 移行元」のときしか動かない** — 切替の後にうっかり
#   流すと、新しいサーバで書いた内容を古いデータで上書きしてしまうため。
#
# 切り戻し:
#   - cutover の前: ./doServerDeploy.sh unfreeze (移行元の app を再開するだけ)
#   - cutover の後: 逆向きの引っ越しとして流す (移行先で書いた分も持ち帰れる)。
#       ./doServerDeploy.sh --from vps1 --to vps2 sync --freeze
#       ./doServerDeploy.sh --from vps1 --to vps2 cutover
#
# 使い方:
#   ./doServerDeploy.sh [--from <host>] [--to <host>] [--demo] [--yes] <phase> [--freeze]
#   ./doServerDeploy.sh -h    (この説明を表示)
#
#   --from / --to  ssh 接続先 (default: vps2 / vps1)
#   --demo         デモ (qr-demo、qr-demo.tommie.jp) を運ぶ
#   --yes          確認プロンプトを省く
#
# 環境変数:
#   DEPLOY_DST_IP     移行先の公開 IP (default: 移行先から ifconfig.me で調べる)
#   DNS_WAIT_MIN      cutover で A レコードの反映を待つ上限 (分, default: 90)
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh
. scripts/lib/remote.sh
. scripts/lib/health.sh
. scripts/lib/dumpGuard.sh

usage() {
  echo "usage: $0 [--from <host>] [--to <host>] [--demo] [--yes] <check|prepare|sync|app|edge|cutover|retire|unfreeze|all> [--freeze]" >&2
  echo "       $0 -h    (詳しい説明)" >&2
  exit 1
}

# -h: 冒頭のコメントをそのまま説明として出す (doDeploy.sh と同じ流儀)
help() {
  sed -n '2,/^set -euo pipefail$/ { /^#/ s/^# \{0,1\}//p }' "$0"
  exit 0
}

PHASE=""
SRC="vps2"
DST="vps1"
DEMO=0
FREEZE=0
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) help ;;
    --from) [ $# -ge 2 ] || usage; SRC="$2"; shift ;;
    --to) [ $# -ge 2 ] || usage; DST="$2"; shift ;;
    --demo) DEMO=1 ;;
    --freeze) FREEZE=1 ;;
    --yes) YES=1 ;;
    check|prepare|sync|app|edge|cutover|retire|unfreeze|all)
      [ -z "$PHASE" ] || usage
      PHASE="$1"
      ;;
    *) usage ;;
  esac
  shift
done
[ -n "$PHASE" ] || usage
[ "$SRC" != "$DST" ] || die "移行元と移行先が同じ ($SRC)"
# 止めるのは最終同期の直前だけ。他のフェーズに付いていたら打ち間違いとみなす
if [ "$FREEZE" = 1 ] && [ "$PHASE" != sync ]; then die "--freeze は sync にだけ付けられる"; fi

# スタックごとの差分。接続先の 3 点 (ディレクトリ / DB ポート / app ポート) は
# target.sh が束で決める (REMOTE はこの後 on_src / on_dst が都度差し替える)
if [ "$DEMO" = 1 ]; then
  resolve_target demo
  STACK="demo"
  SITE="${DEPLOY_SITE:-qr-demo.tommie.jp}"
  PROJECT="qr-demo"   # compose のプロジェクト名 (デモの .env の COMPOSE_PROJECT_NAME)
  DBS=(qr "$DEMO_SEED_DB")
  CONFIG_FILES=(compose.yaml compose.demo.yaml .env reseedDemo.sh)
else
  resolve_target prod
  STACK="prod"
  SITE="${DEPLOY_SITE:-qr.tommie.jp}"
  PROJECT="qr-search"
  DBS=(qr)
  CONFIG_FILES=(compose.yaml .env)
fi
CURRENT="$(deploy_host "$STACK")"   # いま配布先として控えてあるサーバ
DEMO_FLAG=""                        # 案内に出す再実行コマンド用
if [ "$DEMO" = 1 ]; then DEMO_FLAG=" --demo"; fi

IMAGE="qr-search-app:latest"
REGISTRY_REMOTE_PORT=5000
REG="127.0.0.1:${REGISTRY_REMOTE_PORT}/qr-search-app"
GIT_NOTES_DIR="/app/data/git-notes"
GATED_MARK="ログインが必要です"   # 未ログインのトップに出る案内 (doDeployNginx.sh と同じ印)
MIN_DISK_GB=10
WARN_MEM_MB=600
DNS_WAIT_MIN="${DNS_WAIT_MIN:-90}"
DNS_POLL_SECS=15
TS="$(date +%Y%m%d_%H%M%S)"
DST_IP="${DEPLOY_DST_IP:-}"

# --- ssh: 2 台それぞれに master を張り、全呼び出しをそれに乗せる -----------------
#
# remote.sh の関数は REMOTE / SSH_CTRL を読むので、呼ぶたびに差し替える
# (bash は関数呼び出しの前置代入をその呼び出しの間だけ効かせる)。
# 1 フェーズで数十回 ssh するので、毎回のハンドシェイクを省く意味は大きい
CTRL_SRC="$(mktemp -u "${TMPDIR:-/tmp}/qr-move-src-ssh.XXXXXX")"
CTRL_DST="$(mktemp -u "${TMPDIR:-/tmp}/qr-move-dst-ssh.XXXXXX")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/qr-move.XXXXXX")"
# 計時は trap より先に始める (print_timing が未定義の配列を読んで落ちないように)
timing_start

on_src() { REMOTE="$SRC" SSH_CTRL="$CTRL_SRC" SSH_MASTER_OPEN=1 "$@"; }
on_dst() { REMOTE="$DST" SSH_CTRL="$CTRL_DST" SSH_MASTER_OPEN=1 "$@"; }
src_sh() { on_src remote_ssh "$SRC" "$@"; }
dst_sh() { on_dst remote_ssh "$DST" "$@"; }

cleanup() {
  ssh -S "$CTRL_SRC" -O exit "$SRC" 2>/dev/null || true
  ssh -S "$CTRL_DST" -O exit "$DST" 2>/dev/null || true
  rm -rf "$WORK"
  print_timing
}
trap cleanup EXIT

open_master() {
  ssh -M -S "$2" -f -N -o BatchMode=yes -o ConnectTimeout=10 "$1" \
    || die "$1 に ssh 接続できない (鍵の確認で止まらないよう BatchMode で試している)"
}

# --- 小道具 ------------------------------------------------------------------

confirm() {
  [ "$YES" = 1 ] && return 0
  local answer
  read -r -p "$1 [y/N] " answer
  case "$answer" in
    [yY] | [yY][eE][sS]) ;;
    *) die "中止した" ;;
  esac
}

# app イメージで 1 回きりのコマンドを流す。**app コンテナが止まっていても使える**
# (--freeze の後も git-notes を読めるように exec ではなく run にする)。
# 引数は remote_compose と同じく 1 つの文字列で、先頭がエントリポイント
app_run() { remote_compose "run --rm --no-deps -T --entrypoint $*"; }

# app_running — 呼び出し側の on_src / on_dst の app が動いているか
app_running() { remote_compose "ps --status running --services" </dev/null | grep -qx app; }

dst_ip() {
  if [ -z "$DST_IP" ]; then
    DST_IP="$(dst_sh "curl -fsS4 --max-time 10 https://ifconfig.me")" \
      || die "$DST の公開 IP を調べられない。DEPLOY_DST_IP=<IP> を付けて流し直すこと"
  fi
  echo "$DST_IP"
}

# 移行元で動いているイメージの版 (package.json)。止まっていても読めるよう docker run で見る
image_version() {
  src_sh "docker run --rm --entrypoint node '$IMAGE' -p \"require('./package.json').version\"" </dev/null
}

# 移行先のレジストリに版タグがあるか
dst_registry_has() {
  dst_sh "curl -fsS -o /dev/null -I \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
    -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
    'http://127.0.0.1:${REGISTRY_REMOTE_PORT}/v2/qr-search-app/manifests/$1' 2>/dev/null"
}

# 本番が載っているのは移行元か。prepare / sync などは移行元が「生きている側」の
# ときしか流してはいけない (切替後に流すと新しいサーバの内容を古いデータで潰す)
require_src_live() {
  [ "$CURRENT" = "$SRC" ] || die "配布先の控えが $CURRENT になっている ($DEPLOY_HOST_DIR/host-$STACK)。
     $SRC → $DST の引っ越しは切替済みか、向きが逆。切り戻すなら --from $CURRENT --to … で流すこと"
}

# verify_site [curl の追加引数 (--resolve など)...]
# 未ログインに中身を出していないこと (案内の印) と、app まで届くこと (manifest 200) を見る
verify_site() {
  local body status
  body="$(curl -sS --max-time 20 "$@" "https://$SITE/")" || die "https://$SITE/ に届かない"
  grep -q "$GATED_MARK" <<<"$body" \
    || die "https://$SITE/: 未ログインなのに「$GATED_MARK」の案内が出ていない"
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@" "https://$SITE/manifest.webmanifest")" || true
  [ "$status" = 200 ] || die "https://$SITE/manifest.webmanifest が $status (app まで届いていない)"
  echo "OK: https://$SITE/ -> 未ログインには案内のみ / manifest 200"
}

# --- check -------------------------------------------------------------------

check_port() {
  local port="$1" listening owner
  listening="$(dst_sh "ss -Hltn 'sport = :$port'")"
  if [ -z "$listening" ]; then
    echo "  :$port 空き"
    return 0
  fi
  owner="$(dst_sh "docker ps --filter 'publish=$port' --format '{{.Names}}'")"
  case "$owner" in
    "$PROJECT"-* | registry-*) echo "  :$port 使用中 ($owner — この引っ越しで立てたもの)" ;;
    *) die "$DST の :$port が別のもの (${owner:-docker の外}) に使われている" ;;
  esac
}

dns_report() {
  local ns answer
  ns="$(dig +short NS "${SITE#*.}" | head -1)"
  answer="$(dig +noall +answer "@$ns" "$SITE" A)"
  echo "  権威 ($ns): ${answer:-応答なし}"
  echo "  $DST の公開 IP: $(dst_ip)"
  if [ "$(awk '{print $2; exit}' <<<"$answer")" -gt 300 ] 2>/dev/null; then
    echo "  WARN: TTL が 300 秒より長い。切替の前日までに 300 へ下げておくと、反映待ちと切り戻しが速い" >&2
  fi
}

phase_check() {
  log "check 1/4 接続先 (移行元 $SRC → 移行先 $DST、スタック $STACK、配布先の控え $CURRENT)"
  echo "OK: 両方に ssh できる"
  step_done "check 接続"

  log "check 2/4 移行先 $DST の道具と空き"
  local missing mem_mb disk_gb
  missing="$(dst_sh 'for c in docker nginx certbot curl; do command -v "$c" >/dev/null || printf "%s " "$c"; done
    docker compose version >/dev/null 2>&1 || printf "docker-compose "
    sudo -n true 2>/dev/null || printf "sudo(NOPASSWD) "
    # 証明書の renewal は nginx 方式で書かれている。certbot 本体だけだと
    # cutover の更新試行で初めて落ちる (vps1 で実際に踏んだ)
    sudo -n certbot plugins 2>/dev/null | grep -q "^\* nginx" || printf "python3-certbot-nginx "')"
  [ -z "$missing" ] || die "$DST に足りないもの: $missing"
  mem_mb="$(dst_sh "awk '/MemAvailable/ {print int(\$2 / 1024)}' /proc/meminfo")"
  disk_gb="$(dst_sh "df -BG --output=avail ~ | tail -1 | tr -dc 0-9")"
  echo "  空きメモリ ${mem_mb}MB / 空きディスク ${disk_gb}GB"
  [ "$disk_gb" -ge "$MIN_DISK_GB" ] || die "$DST の空きディスクが ${MIN_DISK_GB}GB 未満"
  if [ "$mem_mb" -lt "$WARN_MEM_MB" ]; then
    echo "  WARN: 空きメモリが ${WARN_MEM_MB}MB 未満。app + db が載ると swap に追い出されうる" >&2
  fi
  check_port "$REMOTE_APP_PORT"
  check_port "$REMOTE_DB_PORT"
  check_port "$REGISTRY_REMOTE_PORT"
  step_done "check 移行先"

  log "check 3/4 移行元 $SRC のスタックと版"
  local running src_ver local_ver
  running="$(on_src remote_compose "ps --status running --services" </dev/null | tr '\n' ' ')"
  echo "  動いているサービス: ${running:-なし}"
  src_ver="$(image_version)"
  local_ver="$(node -p "require('./package.json').version")"
  echo "  $SRC の版 v$src_ver / 手元の package.json v$local_ver"
  if [ "$src_ver" != "$local_ver" ]; then
    echo "  WARN: 版が違う。app フェーズは手元の版でレジストリを引くので、v$src_ver を checkout した木から流すこと" >&2
  fi
  step_done "check 移行元"

  log "check 4/4 DNS ($SITE)"
  dns_report
  step_done "check DNS"
}

# --- prepare -----------------------------------------------------------------

# 設定ファイルを 1 つ移行元 → 移行先へ。同一なら何もしない。上書きするときは控えを残す
copy_config() {
  local file="$1" path="$REMOTE_DIR/$1" mode=644 src_sum dst_sum
  case "$file" in
    .env) mode=600 ;;            # パスワード類を含む
    *.sh) mode=755 ;;
  esac
  src_sum="$(src_sh "md5sum '$path' | cut -d' ' -f1")" || die "$SRC に $path が無い"
  dst_sum="$(dst_sh "md5sum '$path' 2>/dev/null | cut -d' ' -f1" || true)"
  if [ "$src_sum" = "$dst_sum" ]; then
    echo "  同一: $file"
    return 0
  fi
  if [ -n "$dst_sum" ]; then
    dst_sh "cp -p '$path' '$path.bak-$TS'"
  fi
  # 中身は手元のディスクに落とさない (.env のパスワード類が手元に残らないように)
  src_sh "cat '$path'" | dst_sh "umask 077 && cat > '$path.tmp' && chmod $mode '$path.tmp' && mv '$path.tmp' '$path'"
  [ "$(dst_sh "md5sum '$path' | cut -d' ' -f1")" = "$src_sum" ] || die "$file の転送結果が移行元と一致しない"
  echo "  転送: $file${dst_sum:+ (前の内容は $file.bak-$TS)}"
}

# イメージの中身の指紋 (レイヤーの diff ID 列のハッシュ)。
#
# **.Id では比べられない。** 従来の overlay2 ストアでは .Id = config のダイジェストだが、
# containerd のイメージストア (Docker 29 の新規インストールの既定) では manifest の
# ダイジェストになり、同じイメージを save | load しても別の値になる。
# 非圧縮レイヤーの diff ID はどちらのストアでも同じ
IMAGE_FINGERPRINT_CMD="docker image inspect -f '{{json .RootFS.Layers}}' '$IMAGE' | sha256sum | cut -c1-12"

transfer_image() {
  local src_id dst_id size_mb ver
  src_id="$(src_sh "docker image inspect '$IMAGE' >/dev/null && $IMAGE_FINGERPRINT_CMD")" || die "$SRC に $IMAGE が無い"
  dst_id="$(dst_sh "docker image inspect '$IMAGE' >/dev/null 2>&1 && $IMAGE_FINGERPRINT_CMD" || true)"
  if [ "$src_id" = "$dst_id" ]; then
    echo "  同一のイメージが既にある (レイヤー指紋 $src_id)"
  else
    size_mb="$(( $(src_sh "docker image inspect -f '{{.Size}}' '$IMAGE'") / 1024 / 1024 ))"
    echo "  ${size_mb}MB (展開後) を gzip で送る。数分かかる"
    # dd は進捗 (転送済みバイト数) を出すためだけに挟む
    src_sh "docker save '$IMAGE' | gzip -1" </dev/null \
      | dd bs=1M status=progress \
      | dst_sh "gunzip | docker load"
    dst_id="$(dst_sh "$IMAGE_FINGERPRINT_CMD")"
    [ "$src_id" = "$dst_id" ] || die "転送したイメージの中身が移行元と違う (レイヤー指紋 $src_id / $dst_id)"
    echo "  OK: レイヤー指紋 $dst_id"
  fi

  # doDeploy.sh --no-version-up は「レジストリに同版があれば再利用」する。ここで
  # 版タグを入れておけば app フェーズはビルドせず、運んだイメージそのものを使う
  ver="$(image_version)"
  if dst_registry_has "v$ver"; then
    echo "  レジストリに v$ver がある"
  else
    dst_sh "docker tag '$IMAGE' '$REG:v$ver' && docker push -q '$REG:v$ver' >/dev/null && docker rmi '$REG:v$ver' >/dev/null"
    echo "  レジストリに v$ver を登録"
  fi
}

phase_prepare() {
  require_src_live
  log "prepare 1/4 設定ファイル ($SRC:$REMOTE_DIR → $DST:$REMOTE_DIR)"
  dst_sh "mkdir -p '$REMOTE_DIR'"
  local file
  for file in "${CONFIG_FILES[@]}"; do copy_config "$file"; done
  step_done "prepare 設定ファイル"

  log "prepare 2/4 $DST に私設レジストリ"
  DEPLOY_REMOTE="$DST" deploy/setupRegistry.sh
  step_done "prepare レジストリ"

  log "prepare 3/4 イメージ ($SRC → $DST)"
  transfer_image
  step_done "prepare イメージ"

  log "prepare 4/4 $DST の db を起動"
  on_dst remote_compose "up -d --wait db" </dev/null
  step_done "prepare db 起動"
}

# --- sync --------------------------------------------------------------------

freeze_src() {
  confirm "$SRC の app を止める。https://$SITE/ は DNS の切替が済むまで 502 になる。続行するか?"
  on_src remote_compose "stop app" </dev/null
  if [ "$DEMO" = 1 ]; then
    # 毎時の再シードが同期の途中で DB を作り直さないように
    src_sh "systemctl --user stop qr-demo-reseed.timer"
  fi
  echo "OK: $SRC の app を停止 (取りやめるときは: $0$DEMO_FLAG unfreeze)"
}

pgroonga_index_count() {
  query_remote "select count(*) from pg_indexes where indexdef ilike '%pgroonga%'" "$1"
}

sync_db() {
  local db="$1" dump="backup/${SRC}-move-${STACK}-${1}_${TS}.dump" before after dst_sig src_idx dst_idx
  echo "--- $db"
  before="$(on_src query_remote "$DB_SIGNATURE_SQL" "$db")"
  echo "  移行元: $before"
  on_src remote_db pg_dump -U qr -d "$db" -Fc </dev/null | dd of="$dump" bs=1M status=progress
  require_nonempty --remove "$dump" "$SRC の $db のダンプが空"
  echo "  ダンプ: $dump ($(du -h "$dump" | cut -f1))"
  after="$(on_src query_remote "$DB_SIGNATURE_SQL" "$db")"
  [ "$before" = "$after" ] \
    || die "ダンプ中に $SRC の $db が更新された。流し直すこと (本番切替なら --freeze を付ける)"

  # DROP DATABASE はトランザクションに入れられないので、1 文ずつ psql に渡す。
  # WITH (FORCE) で残っている接続 (psql の開きっぱなし等) ごと切る
  on_dst query_remote "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" postgres >/dev/null
  on_dst query_remote "CREATE DATABASE \"$db\" OWNER qr" postgres >/dev/null
  # 空の DB へ入れるので --clean は不要。両端が同じ pgroonga イメージなので
  # 拡張と索引もそのまま戻る (pg_restore は索引を作り直すので createdb -T の罠も無い)
  dd if="$dump" bs=1M status=progress | on_dst remote_db pg_restore --no-owner -U qr -d "$db"

  dst_sig="$(on_dst query_remote "$DB_SIGNATURE_SQL" "$db")"
  echo "  移行先: $dst_sig"
  [ "$dst_sig" = "$before" ] || die "$db の中身が移行元と一致しない ($dump から入れ直せる)"
  # 件数とハッシュが合っても、PGroonga 索引が欠けていれば全文検索だけが静かに遅くなる
  src_idx="$(on_src pgroonga_index_count "$db")"
  dst_idx="$(on_dst pgroonga_index_count "$db")"
  [ "$dst_idx" = "$src_idx" ] && [ "$dst_idx" -gt 0 ] \
    || die "$db の PGroonga 索引の数が違う (移行元 $src_idx / 移行先 $dst_idx)"
  on_dst query_remote "select count(*) from items where memo &@ 'a'" "$db" >/dev/null \
    || die "$db で PGroonga の全文検索が動かない"
  echo "  OK: 一致 / PGroonga 索引 $dst_idx 本・全文検索も動く"
}

git_notes_refs() {
  app_run "sh app -c 'git -C $GIT_NOTES_DIR for-each-ref 2>/dev/null || echo \"(履歴なし)\"'" </dev/null
}

sync_git_notes() {
  local out="backup/${SRC}-move-${STACK}-git-notes_${TS}.tar" src_refs dst_refs
  echo "--- git-notes"
  # bundle ではなく volume を丸ごと tar で運ぶ。作業ツリーと .git/config
  # (コミットの署名者など) まで元のまま揃えるため
  on_src app_run "tar app -C $GIT_NOTES_DIR -cf - ." </dev/null >"$out"
  require_nonempty --remove "$out" "$SRC の git-notes を読めない"
  echo "  取得: $out ($(du -h "$out" | cut -f1))"
  on_dst app_run "sh app -c 'find $GIT_NOTES_DIR -mindepth 1 -delete && tar -xf - -C $GIT_NOTES_DIR'" <"$out"
  src_refs="$(on_src git_notes_refs)"
  dst_refs="$(on_dst git_notes_refs)"
  [ "$src_refs" = "$dst_refs" ] || die "git-notes の ref が移行元と一致しない ($out から入れ直せる)"
  echo "  OK: ref 一致 ($(wc -l <<<"$dst_refs") 本)"
}

phase_sync() {
  require_src_live
  local dst_was_running=0
  log "sync 1/4 準備"
  if [ "$FREEZE" = 1 ]; then freeze_src; fi
  mkdir -p backup
  on_dst remote_compose "up -d --wait db" </dev/null
  if on_dst app_running; then
    dst_was_running=1
    on_dst remote_compose "stop app" </dev/null   # DB を作り直す間、接続を切っておく
  fi
  step_done "sync 準備"

  log "sync 2/4 DB (${DBS[*]})"
  local db
  for db in "${DBS[@]}"; do sync_db "$db"; done
  step_done "sync DB"

  log "sync 3/4 git-notes"
  sync_git_notes
  step_done "sync git-notes"

  log "sync 4/4 移行先の app"
  if [ "$dst_was_running" = 1 ]; then
    on_dst remote_compose "up -d --no-build app" </dev/null
    wait_healthy on_dst remote_http_status "http://127.0.0.1:${REMOTE_APP_PORT}/" \
      || die "$DST の app が起動しない。ssh $DST 'cd $REMOTE_DIR && docker compose logs app' を確認すること"
  else
    echo "  app はまだ立てていない (次の app フェーズで立てる)"
  fi
  step_done "sync app 再開"
}

# --- app ---------------------------------------------------------------------

phase_app() {
  require_src_live
  local ver local_ver
  ver="$(image_version)"
  local_ver="$(node -p "require('./package.json').version")"
  # doDeploy.sh --no-version-up は**手元の** package.json の版でレジストリを引く。
  # ずれていると、運んだイメージではなく手元からビルドした別物が載ってしまう
  [ "$ver" = "$local_ver" ] || die "手元の package.json (v$local_ver) と $SRC の版 (v$ver) が違う。
     v$ver を checkout したワークツリーから流すこと"
  dst_registry_has "v$ver" || die "$DST のレジストリに v$ver が無い。先に prepare を流すこと"

  log "app 1/1 doDeploy.sh で $DST に app を立てる (v$ver を再利用。ビルドはしない)"
  local args=(--no-version-up)
  if [ "$DEMO" = 1 ]; then args+=(--demo); fi
  DEPLOY_REMOTE="$DST" ./doDeploy.sh "${args[@]}"
  step_done "app doDeploy.sh"
}

# --- edge --------------------------------------------------------------------

copy_certs() {
  src_sh "sudo test -f /etc/letsencrypt/renewal/$SITE.conf" || die "$SRC に $SITE の証明書が無い"
  # サイトの分は移行元が正なので上書きする。live/ の symlink は tar がそのまま運ぶ
  src_sh "sudo tar czf - -C /etc/letsencrypt live/$SITE archive/$SITE renewal/$SITE.conf" </dev/null \
    | dst_sh "sudo tar xzf - -C /etc/letsencrypt"
  # 共有の分は移行先に既にあれば残す。accounts を運ぶのは、renewal/*.conf が
  # 移行元のアカウント ID を指しているため (無いと 90 日後の自動更新が落ちる)
  src_sh "sudo tar czf - -C /etc/letsencrypt accounts options-ssl-nginx.conf ssl-dhparams.pem" </dev/null \
    | dst_sh "sudo tar xzf - -C /etc/letsencrypt --skip-old-files"
  echo "  OK: $(dst_sh "sudo openssl x509 -noout -enddate -in /etc/letsencrypt/live/$SITE/fullchain.pem")"
}

install_nginx_conf() {
  local conf="deploy/nginx/$SITE.conf" remote_conf="/etc/nginx/sites-available/$SITE"
  local enabled="/etc/nginx/sites-enabled/$SITE" src_copy="$WORK/src.conf" stage="/tmp/$SITE.conf.$$"
  [ -f "$conf" ] || die "$conf が無い"
  # 移行元に配置済みのものが**リポジトリのどの版とも一致しない** = サーバ側で
  # 書き換えられている (certbot --nginx の再実行など)。そのまま移すとその変更を
  # 落とすので止める (doDeployNginx.sh のドリフト検知と同じ判定)。
  # 過去の版と一致するだけなら、リポジトリが新しいだけなので手元のものを入れる
  src_sh "cat '$remote_conf'" >"$src_copy"
  if ! git cat-file -e "$(git hash-object "$src_copy")^{blob}" 2>/dev/null; then
    diff -u --label "$SRC (配置済み)" --label "リポジトリ" "$src_copy" "$conf" || true
    die "$SRC の配置済みの conf がリポジトリのどの版とも一致しない (サーバ側で書き換えられている)。
     差分を取り込んでコミットしてから流し直すこと"
  fi
  if ! cmp -s "$src_copy" "$conf"; then
    echo "  $SRC の conf はリポジトリの過去の版。手元の版を入れる"
  fi
  if dst_sh "cmp -s '$remote_conf' /dev/stdin && [ -L '$enabled' ]" <"$conf"; then
    echo "  同一の conf が有効になっている"
    return 0
  fi
  on_dst remote_scp -q "$conf" "$DST:$stage"
  dst_sh "sudo install -o root -g root -m 644 '$stage' '$remote_conf' && rm -f '$stage' && sudo ln -sfn '$remote_conf' '$enabled'"
  # nginx -t は全体を検証するので配置後にしか試せない。落ちたら有効化を外して戻す
  # (壊れたまま残すと、次の無関係な reload で kick.tommie.jp まで巻き込んで落ちる)
  if ! dst_sh "sudo nginx -t" 2>&1; then
    dst_sh "sudo rm -f '$enabled'"
    die "nginx -t が失敗した。$SITE の有効化を外した (reload はしていない)"
  fi
  dst_sh "sudo systemctl reload nginx"
  echo "  OK: $remote_conf を有効化して reload"
}

phase_edge() {
  require_src_live
  log "edge 1/3 証明書 ($SITE) を $SRC → $DST"
  copy_certs
  step_done "edge 証明書"

  log "edge 2/3 nginx の conf"
  install_nginx_conf
  step_done "edge nginx"

  log "edge 3/3 $DST を直接叩いて確認 (curl --resolve。DNS はまだ $SRC を向いたまま)"
  verify_site --resolve "$SITE:443:$(dst_ip)"
  step_done "edge 確認"
}

# --- cutover -----------------------------------------------------------------

wait_dns() {
  local ip="$1" ns auth pub here i polls
  ns="$(dig +short NS "${SITE#*.}" | head -1)"
  polls=$(( DNS_WAIT_MIN * 60 / DNS_POLL_SECS ))
  for ((i = 1; i <= polls; i++)); do
    auth="$(dig +short "@$ns" "$SITE" A | tail -1)"
    pub="$(dig +short @1.1.1.1 "$SITE" A | tail -1)"
    here="$(getent ahostsv4 "$SITE" | awk 'NR == 1 {print $1}')"
    printf '  [%s] 権威 %s / 1.1.1.1 %s / 手元 %s\n' "$(date +%H:%M:%S)" "${auth:-?}" "${pub:-?}" "${here:-?}"
    if [ "$auth" = "$ip" ] && [ "$pub" = "$ip" ] && [ "$here" = "$ip" ]; then
      return 0
    fi
    sleep "$DNS_POLL_SECS"
  done
  die "${DNS_WAIT_MIN} 分待っても反映しなかった。A レコードを確かめ、cutover を流し直すこと"
}

switch_reseed_timer() {
  echo "--- 毎時の再シードを $SRC → $DST へ"
  dst_sh "mkdir -p .config/systemd/user"
  on_dst remote_scp -q deploy/systemd/qr-demo-reseed.service deploy/systemd/qr-demo-reseed.timer "$DST:.config/systemd/user/"
  # linger が無いと、ssh を抜けた途端にユーザの systemd ごとタイマーが止まる
  dst_sh 'sudo loginctl enable-linger "$USER" && systemctl --user daemon-reload && systemctl --user enable --now qr-demo-reseed.timer'
  src_sh "systemctl --user disable --now qr-demo-reseed.timer" \
    || echo "  WARN: $SRC のタイマーを止められなかった。手で: ssh $SRC systemctl --user disable --now qr-demo-reseed.timer" >&2
}

phase_cutover() {
  require_src_live
  # 移行元が動いたまま DNS を移すと、古い DNS を引いた端末が移行元へ書き込み続け、
  # データが 2 台に分かれる (後から片方を捨てるしかない)
  if on_src app_running; then
    die "$SRC の app がまだ動いている。先に $0$DEMO_FLAG sync --freeze で止めて最終同期すること"
  fi
  local ip
  ip="$(dst_ip)"

  log "cutover 1/4 $DST を直接叩いて最終確認"
  verify_site --resolve "$SITE:443:$ip"
  step_done "cutover 最終確認"

  log "cutover 2/4 DNS の切替待ち"
  echo "  DNS の管理画面で $SITE の A レコードを $ip に変えること。"
  echo "  反映するまで ${DNS_POLL_SECS} 秒おきに見張る (最大 ${DNS_WAIT_MIN} 分)。"
  wait_dns "$ip"
  step_done "cutover DNS 待ち"

  log "cutover 3/4 実際の DNS で確認"
  verify_site
  step_done "cutover 確認"

  log "cutover 4/4 配布先の控えを $DST へ ($DEPLOY_HOST_DIR/host-$STACK)"
  set_deploy_host "$STACK" "$DST"
  echo "OK: 以後の ./doDeploy.sh$DEMO_FLAG などは $DST へ配る"
  if [ "$DEMO" = 1 ]; then switch_reseed_timer; fi
  # 証明書の自動更新が移行先で通るか (HTTP-01 は DNS が向いた今からしか試せない)
  dst_sh "sudo certbot renew --cert-name '$SITE' --dry-run" \
    || echo "WARN: $DST での証明書更新の試行が失敗した。90 日後の自動更新までに直すこと" >&2
  step_done "cutover 控え + 証明書"
  log "切替完了。落ち着いたら (TTL×2 経過後): $0$DEMO_FLAG retire"
}

# --- retire / unfreeze -------------------------------------------------------

phase_retire() {
  [ "$CURRENT" = "$DST" ] || die "まだ切り替えていない (配布先の控えが $CURRENT)。先に cutover を流すこと"
  confirm "$SRC の $PROJECT スタックを止め、nginx から $SITE を外す (データと証明書は残す)。続行するか?"
  log "retire 1/2 $SRC の $PROJECT を停止"
  on_src remote_compose "stop" </dev/null
  step_done "retire スタック停止"

  log "retire 2/2 $SRC の nginx から $SITE を外す"
  src_sh "sudo rm -f '/etc/nginx/sites-enabled/$SITE' && sudo nginx -t && sudo systemctl reload nginx"
  step_done "retire nginx"
  echo "volume と証明書は $SRC に残してある。証明書の更新が失敗し続けるのが嫌なら:"
  echo "  ssh $SRC sudo certbot delete --cert-name $SITE"
}

phase_unfreeze() {
  require_src_live
  log "unfreeze $SRC の app を再開"
  on_src remote_compose "start app" </dev/null
  if [ "$DEMO" = 1 ]; then src_sh "systemctl --user start qr-demo-reseed.timer"; fi
  wait_healthy on_src remote_http_status "http://127.0.0.1:${REMOTE_APP_PORT}/" \
    || die "$SRC の app が起動しない"
  step_done "unfreeze"
}

# --- 本体 --------------------------------------------------------------------

open_master "$SRC" "$CTRL_SRC"
open_master "$DST" "$CTRL_DST"

case "$PHASE" in
  check) phase_check ;;
  prepare) phase_prepare ;;
  sync) phase_sync ;;
  app) phase_app ;;
  edge) phase_edge ;;
  cutover) phase_cutover ;;
  retire) phase_retire ;;
  unfreeze) phase_unfreeze ;;
  all)
    phase_check
    phase_prepare
    phase_sync
    phase_app
    phase_edge
    log "下ごしらえ完了。切替は: $0$DEMO_FLAG sync --freeze → $0$DEMO_FLAG cutover"
    ;;
esac
