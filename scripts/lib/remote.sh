# shellcheck shell=bash
# do*.sh 共通: リモート (vps2) とローカルの db を叩く小道具 (docs/93-リファクタリング計画.md §7-2)。
# log.sh の die を使うので、先に log.sh を source すること。
#
# リモート側の関数は REMOTE と REMOTE_DIR (target.sh の resolve_target が決める) を読む。
#
# ssh は ControlMaster で 1 本に束ねられる。ssh_master_open で張ったあとは、
# remote_ssh (とそれを使う remote_* 全部) が自動でその master に乗る
# (毎回のハンドシェイクを省く)。張る前の呼び出しは素の ssh のまま。
# 終了時は ssh_master_close を EXIT trap から呼んで必ず閉じる。

SSH_CTRL=""
SSH_MASTER_OPEN=0

# ssh_master_init <名前>
# 制御ソケットの置き場を決める (まだ張らない)。名前は一時ファイル名の見分け用
ssh_master_init() {
  SSH_CTRL="$(mktemp -u "${TMPDIR:-/tmp}/qr-$1-ssh.XXXXXX")"
}

# ssh_master_open <ローカルポート> <リモートポート>
# master を張り、ローカル 127.0.0.1:<ローカルポート> → リモート 127.0.0.1:<リモートポート>
# のトンネルを載せる。転送に失敗したら張らずに落ちる (ExitOnForwardFailure)
ssh_master_open() {
  ssh -M -S "$SSH_CTRL" -f -N -o ExitOnForwardFailure=yes \
    -L "127.0.0.1:$1:127.0.0.1:$2" "$REMOTE"
  SSH_MASTER_OPEN=1
}

# 張っていなくても (途中で落ちた場合も) 黙って通る。EXIT trap 用
ssh_master_close() {
  [ -n "$SSH_CTRL" ] || return 0
  ssh -S "$SSH_CTRL" -O exit "$REMOTE" 2>/dev/null || true
}

# ssh_forward_add / ssh_forward_cancel <ローカルポート> <リモートポート>
# 張ってある master にトンネルを 1 本足す / 外す
ssh_forward_add() {
  remote_ssh -O forward -L "127.0.0.1:$1:127.0.0.1:$2" "$REMOTE"
}
ssh_forward_cancel() {
  remote_ssh -O cancel -L "127.0.0.1:$1:127.0.0.1:$2" "$REMOTE" 2>/dev/null || true
}

# remote_ssh <ssh の引数...> — master を張ってあればそれに乗る ssh
remote_ssh() {
  if [ "$SSH_MASTER_OPEN" = 1 ]; then
    ssh -S "$SSH_CTRL" "$@"
  else
    ssh "$@"
  fi
}

# remote_scp <scp の引数...> — master を張ってあればそれに乗る scp
remote_scp() {
  if [ "$SSH_MASTER_OPEN" = 1 ]; then
    scp -o "ControlPath=$SSH_CTRL" "$@"
  else
    scp "$@"
  fi
}

# ssh で入れるか (鍵の確認プロンプトで止まらないよう BatchMode で試す)
remote_reachable() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE" true 2>/dev/null
}

# remote_env_var <名前> — リモートの compose ディレクトリの .env から値を 1 つ読む
remote_env_var() {
  remote_ssh "$REMOTE" "grep '^$1=' '$REMOTE_DIR/.env' | cut -d= -f2-"
}

# remote_db_url <ローカルポート> <DB 名>
# トンネル越しにリモート DB を叩くための DATABASE_URL を出す。
# パスワードはリモートの .env の POSTGRES_PASSWORD。記号を含みうるので URL エンコードする。
# コマンド置換の中で呼ぶ前提 (errexit が効かないので、失敗は明示的に返す)
remote_db_url() {
  local pw encoded
  pw="$(remote_env_var POSTGRES_PASSWORD)" || return
  [ -n "$pw" ] || die "$REMOTE の $REMOTE_DIR/.env から POSTGRES_PASSWORD を取得できない"
  encoded="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$pw")" || return
  echo "postgresql://qr:${encoded}@127.0.0.1:$1/$2"
}

# remote_compose <docker compose の引数...> — リモートの compose ディレクトリで docker compose。
# 引数は $* で連結してリモートのシェルに渡るのでクォートが保てない。
# クォートを含むものは 1 つの文字列にして渡すこと
remote_compose() {
  remote_ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose $*"
}

# ローカル / リモートの db コンテナ内でコマンドを実行する。
# SQL のようなクォートを含む文字列は引数で渡さず、psql の標準入力から流すこと
# (query_* を使う。ssh・docker compose exec -T とも stdin を素通しする)
local_db() { docker compose exec -T db "$@"; }
remote_db() { remote_compose exec -T db "$@"; }

# query_local / query_remote <SQL> [DB 名 (既定 qr)]
query_local() { local_db psql -U qr -d "${2:-qr}" -tA -v ON_ERROR_STOP=1 <<< "$1"; }
query_remote() { remote_db psql -U qr -d "${2:-qr}" -tA -v ON_ERROR_STOP=1 <<< "$1"; }

# remote_http_status <URL> — リモートの中から叩いた状態コード (health.sh の wait_healthy 用)。
# app は 127.0.0.1 にしか公開していないので、外からではなくリモートで curl する
remote_http_status() {
  remote_ssh "$REMOTE" "curl -fsS -o /dev/null -w '%{http_code}' '$1'"
}
