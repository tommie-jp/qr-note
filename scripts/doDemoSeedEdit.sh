#!/usr/bin/env bash
# qr-demo の種 (qr_seed = 初期化ノート) を気軽に編集するための編集セッション
# ラッパ (docs/48-デモ種編集セッション計画.md)。
#
# これは **手元 (ローカル) から叩く** スクリプト。ssh で vps2 のデモスタックを
# 操作する。デモの初期化ノートを直す手順は docs/40 §3 の「種の撮り直し」だが、
# それを「編集を始める → ブラウザで直す → 確定する」の 2 コマンドに包む。
#
# 使い方 (詳細は -h):
#   ./doDemoSeedEdit.sh start          # timer を止めて編集開始 (live はそのまま)
#   ...ブラウザで qr-demo に demo/demo で入り、ノートを編集...
#   ./doDemoSeedEdit.sh commit         # いまの live を新しい種として確定 (timer 再開)
#
# 既定は「live を保持」。人間の編集を消さない安全側をデフォルトにする
# (誤操作で消えると復旧不能なため)。種の状態からやり直すときだけ start --reset。
#
# 環境変数 (接続先は scripts/lib/target.sh の demo と同じ既定):
#   DEPLOY_REMOTE      ssh 先 (default: vps2)。旧名 DEMO_SSH_HOST も受け付ける
#   DEPLOY_REMOTE_DIR  リモートの compose dir (default: ~/qr-demo)。旧名 DEMO_DIR も可
set -euo pipefail

. "$(dirname "$0")/lib/log.sh"
. "$(dirname "$0")/lib/target.sh"

target_alias DEPLOY_REMOTE DEMO_SSH_HOST
target_alias DEPLOY_REMOTE_DIR DEMO_DIR
# REMOTE_DIR は $HOME からの相対。~ を渡さないのは ssh 越しの展開差を避けるため
resolve_target demo
DB_NAME="qr"
SEED_NAME="qr_seed"
DB_USER="qr"
TIMER="qr-demo-reseed.timer"
SERVICE="qr-demo-reseed.service"

info() { echo "    $*"; }
warn() { echo "WARN: $*" >&2; }

usage() {
  cat <<'USAGE'
doDemoSeedEdit.sh — qr-demo の種 (初期化ノート) 編集セッション

デモの初期化ノートは種 DB (qr_seed) の中身そのもの。毎時 0 分のリセットで
live は種へ戻る。このスクリプトは「種を撮り直す」手順 (docs/40 §3) を
編集セッションに包み、ブラウザでいつも通り直したものを新しい種にする。

使い方:
  ./doDemoSeedEdit.sh <サブコマンド> [オプション]

サブコマンド:
  start [--reset]  編集を始める。毎時リセット timer を止めるだけで、
                   **既定では live をそのまま**にする (いまの状態から編集を続ける)。
                   live と種で件数が違えば「未確定のノートが混ざっている」と警告する。
                   --reset: live を種の状態へ戻してから始める (まっさらから作り直す)。
                   既定を保持にする理由: 素の start が live を巻き戻すと、migration
                   デプロイ後にうっかり叩いたとき app が旧スキーマの種で壊れる。
                   人間の編集も毎時境界で消える。破壊的な側を明示フラグに寄せる。

  commit [--stay]  いまの live を新しい種 (qr_seed) として確定する。app を一瞬
                   止めて createdb -T で種を差し替える (数十秒の瞬断)。既定では
                   timer を戻す。
                   --stay: 確定後も timer を止めたまま編集を続ける。「確定 →
                   続けて編集」の間に毎時 0 分をまたいでも消えないようにする。

  abort            編集を破棄する。live を現在の種へ戻し、timer を戻す。

  status           timer の状態・live/種の items 件数・直近 reseed ログを表示。
                   「timer 止めっぱなし」の確認にも使う。

  -h, --help       このヘルプを表示する。

典型的な流れ:
  ./doDemoSeedEdit.sh start
  # https://qr-demo.tommie.jp に demo/demo でログインしてノートを編集
  ./doDemoSeedEdit.sh commit

migration を含むデプロイをデモに当てた直後 (種を旧スキーマのままにしない):
  ./doDemoSeedEdit.sh start      # live (新スキーマ) はそのまま、timer だけ止まる
  ./doDemoSeedEdit.sh commit     # 新スキーマの種を撮り直す

環境変数:
  DEPLOY_REMOTE      ssh 先 (default: vps2)。旧名 DEMO_SSH_HOST も可
  DEPLOY_REMOTE_DIR  リモートの compose dir、$HOME 相対 (default: qr-demo)。旧名 DEMO_DIR も可
USAGE
}

# リモートの compose dir で bash スクリプトを実行する。stdin にヒアドキュメントを流す。
# 呼び出し側は $DB_NAME 等をローカルで展開済みの文字列として渡す。
remote() {
  ssh "$REMOTE" bash -s
}

# systemctl --user を叩く小道具。linger 直後は bus 未起動のことがあるため
# XDG_RUNTIME_DIR を明示する (docs/40 §4 の注意)。
SYSTEMCTL='XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user'

timer_state() {
  ssh "$REMOTE" "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user is-active $TIMER" 2>/dev/null || true
}

seed_exists() {
  ssh "$REMOTE" bash -s <<EOF 2>/dev/null || true
cd "\$HOME/$REMOTE_DIR" 2>/dev/null || exit 0
docker compose exec -T db psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$SEED_NAME'" </dev/null 2>/dev/null || true
EOF
}

# live と種の items 件数を "LIVE SEED" の 1 行で返す (取れなければ該当を ? に)。
# 種は createdb -T 直後に PGroonga 索引が壊れており (docs/39 §6-2)、count が
# index-only scan を選ぶと "object isn't found" で死ぬ。PGOPTIONS で接続時に
# 索引スキャンを切り、必ず seq scan で数える。SET 文を混ぜると psql が "SET"
# タグを出力に足して数値がずれるため、GUC は接続オプションで渡す。
COUNT_PGOPTS="-c enable_indexscan=off -c enable_bitmapscan=off -c enable_indexonlyscan=off"
fetch_counts() {
  ssh "$REMOTE" bash -s <<EOF 2>/dev/null || echo "? ?"
cd "\$HOME/$REMOTE_DIR" 2>/dev/null || { echo "? ?"; exit 0; }
count_db() {
  # </dev/null 必須: docker compose exec -T はヒアドキュメント (この bash -s の
  # stdin) を食い尽くし、以降の行が実行されなくなる。明示的に stdin を切る。
  docker compose exec -T -e PGOPTIONS="$COUNT_PGOPTS" db \
    psql -U "$DB_USER" -d "\$1" -tAc "SELECT count(*) FROM items" </dev/null 2>/dev/null | tr -d '[:space:]'
}
live=\$(count_db "$DB_NAME")
seed=\$(count_db "$SEED_NAME")
echo "\${live:-?} \${seed:-?}"
EOF
}

# live/種の件数を人に見せる。
show_counts() {
  local live seed
  read -r live seed <<<"$(fetch_counts)"
  info "live ($DB_NAME): ${live}    種 ($SEED_NAME): ${seed}"
}

cmd_start() {
  local reset=0
  case "${1:-}" in
    --reset) reset=1 ;;
    "") ;;
    *) die "start の未知のオプション: $1 (使えるのは --reset)" ;;
  esac

  log "1/2 毎時リセット timer を止める"
  ssh "$REMOTE" "$SYSTEMCTL stop $TIMER" \
    || warn "timer を止められなかった (未設置かもしれない。続行する)"

  if [ "$reset" = "1" ]; then
    if [ "$(seed_exists)" != "1" ]; then
      log "2/2 --reset を指定したが種 ($SEED_NAME) がまだ無い → live をそのまま使う"
      info "このまま編集し、最後に commit すると初回の種になる。"
    else
      log "2/2 --reset: live を種の状態へ戻す (reseed)"
      ssh "$REMOTE" "$SYSTEMCTL start $SERVICE" \
        || die "reseed に失敗した。ログ: doDemoSeedEdit.sh status"
    fi
  else
    log "2/2 live はそのまま (既定)。timer だけ止めた"
    local live seed
    read -r live seed <<<"$(fetch_counts)"
    info "live ($DB_NAME): ${live}    種 ($SEED_NAME): ${seed}"
    if [ "$(seed_exists)" != "1" ]; then
      info "種はまだ無い。このまま編集して commit すると初回の種になる。"
    elif [ "$live" != "$seed" ] && [ "$live" != "?" ] && [ "$seed" != "?" ]; then
      warn "live と種で件数が違う。live に種へ未確定のノート (guest の落書き含む)
    が混ざっている可能性がある。まっさらから作り直すなら:
    ./doDemoSeedEdit.sh start --reset"
    fi
  fi

  echo ""
  info "編集を始められる: https://qr-demo.tommie.jp に demo/demo でログイン"
  info "amber の DEMO バッジとバナーを目視すること (本番への誤爆防止)"
  info "終わったら:  ./doDemoSeedEdit.sh commit  (破棄は abort)"
}

cmd_commit() {
  local stay=0
  case "${1:-}" in
    --stay) stay=1 ;;
    "") ;;
    *) die "commit の未知のオプション: $1 (使えるのは --stay)" ;;
  esac

  # ガード: timer が生きていると start を経ていない = 毎時境界で編集が消えた恐れ
  if [ "$(timer_state)" = "active" ] && [ "${DEMO_FORCE:-0}" != "1" ]; then
    die "timer がまだ動いている。start を経ずに commit しようとしている可能性がある。
    先に './doDemoSeedEdit.sh start' で編集セッションを始めること。
    (意図的に current live を種にしたいだけなら: DEMO_FORCE=1 を付けて再実行)"
  fi

  log "いまの live ($DB_NAME) を新しい種 ($SEED_NAME) として確定する"
  # リモートで app 停止 → 接続切断 → 種の差し替え → app 起動。
  # trap で途中失敗でも app を必ず起こす (止めっぱなし事故の防止)。
  #
  # **全 docker compose 呼び出しに </dev/null 必須**。docker compose exec -T は
  # この bash -s の stdin (ヒアドキュメント) を食い尽くし、最初の 1 本より後ろが
  # 実行されなくなる。これを怠ると step 2 の後で stdin が尽き、dropdb/createdb が
  # 走らず「種が更新されないのに app だけ trap で起きて成功に見える」静かな失敗に
  # なる (実際にこれで編集が消えた)。
  remote <<EOF
set -euo pipefail
cd "\$HOME/$REMOTE_DIR"
[ -f compose.yaml ] || { echo "ERROR: \$PWD に compose.yaml が無い" >&2; exit 1; }

restart_app() { echo "==> (trap) app を起こし直す"; docker compose start app </dev/null || true; }
trap restart_app EXIT

echo "==> 1/5 app 停止"
docker compose stop app </dev/null

echo "==> 2/5 ${DB_NAME} への残存接続を切る"
docker compose exec -T db psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
   WHERE datname='$DB_NAME' AND pid <> pg_backend_pid()" </dev/null >/dev/null

echo "==> 3/5 古い種を捨てる"
docker compose exec -T db dropdb --if-exists --force -U "$DB_USER" "$SEED_NAME" </dev/null

echo "==> 4/5 いまの ${DB_NAME} から種を作り直す (createdb -T)"
docker compose exec -T db createdb -U "$DB_USER" -T "$DB_NAME" "$SEED_NAME" </dev/null

echo "==> 5/5 app 起動"
docker compose start app </dev/null
trap - EXIT
EOF

  log "検証: live と種の items 件数 (一致すること)"
  show_counts

  if [ "$stay" = "1" ]; then
    log "--stay: timer は止めたまま (編集を続ける)"
    info "続けて編集し、終わったらまた commit する。完全に終えたら"
    info "commit (--stay なし) か abort で timer を戻すこと。"
    return
  fi

  log "毎時リセット timer を戻す"
  ssh "$REMOTE" "$SYSTEMCTL start $TIMER" \
    || warn "timer を戻せなかった。手動で: systemctl --user start $TIMER"

  echo ""
  info "確定した。次の毎時 0 分のリセットでも、いま編集した内容が残る。"
}

cmd_abort() {
  log "編集を破棄する: live を現在の種へ戻す"
  if [ "$(seed_exists)" != "1" ]; then
    warn "種がまだ無い。破棄する種状態が無いので timer を戻すだけにする。"
  else
    ssh "$REMOTE" "$SYSTEMCTL start $SERVICE" \
      || die "reseed に失敗した。ログ: doDemoSeedEdit.sh status"
  fi

  log "毎時リセット timer を戻す"
  ssh "$REMOTE" "$SYSTEMCTL start $TIMER" \
    || warn "timer を戻せなかった。手動で: systemctl --user start $TIMER"

  echo ""
  info "破棄した。live は種の状態に戻っている。"
}

cmd_status() {
  log "timer ($TIMER)"
  info "状態: $(timer_state)"

  log "items 件数 (live / 種)"
  if [ "$(seed_exists)" != "1" ]; then
    info "種 ($SEED_NAME) はまだ無い。"
  fi
  show_counts

  log "直近の reseed ログ"
  ssh "$REMOTE" \
    "XDG_RUNTIME_DIR=/run/user/\$(id -u) journalctl --user -u $SERVICE -n 3 --no-pager" \
    2>/dev/null || info "(ログ取得不可)"
}

main() {
  local sub="${1:-}"
  case "$sub" in
    start)   shift; cmd_start "$@" ;;
    commit)  shift; cmd_commit "$@" ;;
    abort)   shift; cmd_abort ;;
    status)  shift; cmd_status ;;
    -h|--help|help|"") usage ;;
    *) die "未知のサブコマンド: $sub  (-h でヘルプ)" ;;
  esac
}

main "$@"
