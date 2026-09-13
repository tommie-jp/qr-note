#!/usr/bin/env bash
# vps2 の nginx 設定 (qr.tommie.jp) をリポジトリから反映する。
#
# 前提:
#   - リポジトリの deploy/nginx/qr.tommie.jp.conf が正
#   - conf はコミット済みであること (下記「ドリフト検知」の前提)
#   - vps2 の sudo は NOPASSWD (nginx -t / install / systemctl reload に使う)
#
# 認証はもう nginx ではなくアプリが行う (docs/18-ログイン計画.md)。
# /etc/nginx/.htpasswd-qr はもう読まれない。パスワードの変更は
# vps2 の .env の BASIC_AUTH_HASH_B64 を差し替える (npm run hash-password)。
#
# 使い方:
#   ./doDeployNginx.sh          反映する (差分がなければ何もしない)
#   ./doDeployNginx.sh --check  差分の表示のみ。サーバは一切変更しない
#
# 環境変数で上書き可能:
#   DEPLOY_REMOTE  ssh 接続先 (default: vps2)
#   DEPLOY_SITE    反映するサイトのホスト名 (default: qr.tommie.jp)。
#                  conf のパス (local/remote) とヘルスチェック先を SITE から導く。
#
# デモの conf を反映するとき (docs/39-デモ公開計画.md §7):
#   DEPLOY_SITE=qr-demo.tommie.jp ./doDeployNginx.sh
# (DNS + 証明書は先に手作業で用意しておくこと。conf のヘッダ参照)
set -euo pipefail
cd "$(dirname "$0")"

. scripts/lib/log.sh
. scripts/lib/target.sh

# nginx はホストに 1 つで本番・デモ共用なので、使うのは接続先 (REMOTE) だけ
resolve_target prod
SITE="${DEPLOY_SITE:-qr.tommie.jp}"
# conf のパスは SITE から導く。既定 (qr.tommie.jp) は従来と同一。
# 本番/デモで同じスクリプトを使い回すため、ここをハードコードしない
LOCAL_CONF="deploy/nginx/${SITE}.conf"
REMOTE_CONF="/etc/nginx/sites-available/${SITE}"
# 保護されたパス。認証はもう nginx ではなくアプリが行う (docs/18-ログイン計画.md)
# ため、未ログインでも 401 ではなく 200 + 案内が返るのが正。
# 状態コードでは「守れているか」を判定できないので、本文の印で見る
GATED_URL="https://${SITE}/"
GATED_MARK="ログインが必要です"
# ログイン不要にしたパス。app まで到達するので proxy_pass の確認に使える
BACKEND_URL="https://${SITE}/manifest.webmanifest"

CHECK_ONLY=0
case "${1:-}" in
  --check) CHECK_ONLY=1 ;;
  "") ;;
  # 未知の引数を黙って無視すると、確認のつもりの typo が本番反映になる
  *) die "未知の引数: $1 (使えるのは --check のみ)" ;;
esac

http_status() {
  local status
  # -f は付けない。401 は想定内の応答で、エラー扱いにすると紛らわしい
  status="$(curl -s -o /dev/null -w '%{http_code}' "$1")" || true
  echo "$status"
}

rollback() {
  ssh "$REMOTE" \
    "sudo install -o root -g root -m 644 '$BACKUP' '$REMOTE_CONF' && sudo nginx -t && sudo systemctl reload nginx" \
    || die "ロールバックにも失敗した。$REMOTE で手動復旧すること:
  sudo install -o root -g root -m 644 '$BACKUP' '$REMOTE_CONF' && sudo nginx -t && sudo systemctl reload nginx"
}

[ -f "$LOCAL_CONF" ] || die "$LOCAL_CONF が無い"

log "1/5 リモートとの差分確認 ($REMOTE:$REMOTE_CONF)"
# 末尾改行の有無まで含めてバイト単位で比較するため、一時ファイルに落とす
# (コマンド置換は末尾の改行を落とすので、git hash-object に渡すと実物と別物になる)
REMOTE_COPY="$(mktemp "${TMPDIR:-/tmp}/qr-nginx-remote.XXXXXX")"
trap 'rm -f "$REMOTE_COPY"' EXIT
ssh "$REMOTE" "cat '$REMOTE_CONF'" > "$REMOTE_COPY" || die "$REMOTE から $REMOTE_CONF を読めない"

if cmp -s "$REMOTE_COPY" "$LOCAL_CONF"; then
  echo "差分なし。反映するものはない"
  exit 0
fi

diff -u --label "$REMOTE (現在)" --label "リポジトリ (反映後)" "$REMOTE_COPY" "$LOCAL_CONF" || true

# ドリフト検知: リモートの内容がこのリポジトリのオブジェクトに存在しない場合、
# certbot --nginx の再実行などでサーバ側が直接書き換えられている。
# それを上書きするとサーバ側の変更が失われるため、取り込み直しを促して中断する。
log "2/5 サーバ側ドリフトの確認"
REMOTE_HASH="$(git hash-object "$REMOTE_COPY")"
if ! git cat-file -e "${REMOTE_HASH}^{blob}" 2>/dev/null; then
  echo "リモートの内容がこのリポジトリのどのバージョンとも一致しない。" >&2
  echo "サーバ側で直接編集された可能性がある (certbot --nginx の再実行など)。" >&2
  echo "上書きするとその変更が失われるため中断する。" >&2
  echo "" >&2
  echo "上の diff を確認し、サーバ側の変更を残すなら取り込んでコミットすること。" >&2
  echo "作業ツリーの編集を捨てて構わない場合に限り:" >&2
  echo "  ssh $REMOTE 'cat $REMOTE_CONF' > $LOCAL_CONF" >&2
  die "ドリフトを検知した"
fi
echo "OK: リモートは過去にこのリポジトリから反映した状態"

if [ "$CHECK_ONLY" = "1" ]; then
  log "--check のため反映せず終了"
  exit 0
fi

# 未コミットのまま反映すると、リモートの内容がどのコミットにも存在しない状態になり、
# 次回以降の実行が必ずドリフト検知で止まる。反映はコミット済みの内容に限る。
log "3/5 コミット済みか確認"
git diff --quiet HEAD -- "$LOCAL_CONF" \
  || die "$LOCAL_CONF に未コミットの変更がある。先にコミットすること
  (未コミットのまま反映すると、次回以降ドリフト検知で止まる)"
echo "OK: 作業ツリーはコミット済み"

log "4/5 転送 + 配置 + 構文検証 (nginx -t)"
STAGE="/tmp/${SITE}.conf.$$"
BACKUP="/tmp/${SITE}.conf.bak.$$"
scp -q "$LOCAL_CONF" "$REMOTE:$STAGE"
ssh "$REMOTE" "sudo cp '$REMOTE_CONF' '$BACKUP' && sudo install -o root -g root -m 644 '$STAGE' '$REMOTE_CONF' && rm -f '$STAGE'"

# nginx -t は /etc/nginx/nginx.conf 全体を検証するため、配置後でないと試せない。
# 失敗した場合、稼働中の nginx は旧設定のままだが、壊れたファイルを残すと
# 次回の無関係な reload で落ちるため、バックアップに戻す。
if ! ssh "$REMOTE" 'sudo nginx -t' 2>&1; then
  echo "構文エラー。バックアップに戻す" >&2
  rollback
  die "nginx -t が失敗した (reload はしていない。サーバは旧設定のまま)"
fi

log "5/5 reload + ヘルスチェック"
ssh "$REMOTE" 'sudo systemctl reload nginx'

# 未ログインに中身を出していないこと。ここが今いちばん守りたい不変条件で、
# nginx から auth_basic を外した以上、うっかり素通しになっていないかを
# 反映のたびに確かめる。
#
# 状態コードでは判定できない (未ログインの正解は 401 ではなく 200 + 案内)。
# 本文に案内の印があることを見る。app が落ちていれば 502 で印が無いので、
# その場合もここで落ちる
gated_body="$(curl -s "$GATED_URL")" || true
if ! printf '%s' "$gated_body" | grep -q "$GATED_MARK"; then
  echo "$GATED_URL: 未ログインなのに「$GATED_MARK」の案内が出ていない。" >&2
  echo "中身が素通しになっているか、app へ到達できていない可能性がある。" >&2
  rollback
  die "ヘルスチェック失敗。ロールバックした"
fi
echo "OK: $GATED_URL -> 未ログインには案内のみ (中身は出していない)"

# バックエンド: 認証を外したパスは app まで到達するため、5xx なら proxy_pass が壊れている
backend_status="$(http_status "$BACKEND_URL")"
case "$backend_status" in
  401|5??|000)
    echo "$BACKEND_URL: $backend_status。app へ到達できていない" >&2
    rollback
    die "ヘルスチェック失敗。ロールバックした"
    ;;
esac
echo "OK: $BACKEND_URL -> $backend_status (app へ到達)"

ssh "$REMOTE" "sudo rm -f '$BACKUP'"
log "反映完了"
