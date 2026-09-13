# shellcheck shell=bash
# do*.sh 共通: 起動後のヘルスチェック (docs/93-リファクタリング計画.md §7-2)。
# source して使う。以前は同じ retry ループが doStart.sh・doCopyDBfromVPS2.sh・
# doDeploy.sh の 3 本に並んでいた。違うのは「状態コードをどう取るか」だけなので、
# そこを引数のコマンドに出す。
#
#   if wait_healthy local_http_status -fsSL "$URL"; then ...; fi
#   if wait_healthy remote_http_status "$URL"; then ...; fi   (remote.sh が要る)
#
# 失敗時のメッセージ (どのログを見るべきか) は呼び出し側ごとに違うので、ここでは
# die せず 1 を返す。

HEALTH_RETRIES=30
HEALTH_INTERVAL_SECS=2

# wait_healthy <状態コードを標準出力に出すコマンド...>
# 200 が返るまで HEALTH_RETRIES 回まで待つ。通れば "OK: HTTP 200" を出して 0。
wait_healthy() {
  local i status
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    status="$("$@" || true)"
    if [ "$status" = "200" ]; then
      echo "OK: HTTP $status"
      return 0
    fi
    echo "  waiting... ($i/$HEALTH_RETRIES, status=${status:-none})"
    sleep "$HEALTH_INTERVAL_SECS"
  done
  return 1
}

# local_http_status <curl のオプション> <URL>
# 手元から叩く。オプションを呼び出し側に残すのは、-L (転送を追う) の要否が
# 叩く先で違うため (doStart.sh の説明を参照)
local_http_status() {
  curl "$1" -o /dev/null -w '%{http_code}' "$2"
}
