#!/usr/bin/env bash
# docs/127 の計測を一通り流す (リファクタリングの段ごとの測り直し用。docs/128 §2)。
#
#   1. 作業ツリーから qr-search-app:perf を作り、本番と同じ --memory 1600m で 3301 に立てる
#   2. サーバのベンチ (/api/diag/bench) を 6 回 (1 回目は起動直後の記録、比べるのは 2〜6 回目)
#   3. ブラウザ側 (profileBrowser.ts) を 6 回
#   4. 重い処理のピーク (profilePeakMemory.sh) を 6 回
#   5. 片付け (コンテナとイメージを消す)
#
#   ./scripts/profileAll.sh <出力先のディレクトリ>   (例: perf-baseline/phase2)
#
# ビルドの計測 (profileBuild.sh) はイメージを作り直すので別に流す。
# 手元の DB をそのまま使う (本番と揃えるなら先に doCopyDBfromVPS2.sh)
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:?出力先のディレクトリを指定する (例: perf-baseline/phase2)}"
PORT=3301
BASE="http://localhost:${PORT}"
NAME=qr-measure
TAG=qr-search-app:perf
USER_NAME=e2e
PASS=e2e-test-pass
SERVER_RUNS=6

mkdir -p "$OUT"
jar="$(mktemp)"
cleanup() {
  rm -f "$jar"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> イメージを作る ($TAG)"
# 依存を足した後は .deps/ (版を潰した写し) を作り直さないと Dockerfile が止める
node scripts/writeDepsManifest.mjs >/dev/null
docker build -q -t "$TAG" . </dev/null >/dev/null

echo "==> 計測用サーバを立てる ($BASE)"
hash="$(node -e "const b=require('bcryptjs'); process.stdout.write(Buffer.from(b.hashSync('$PASS',10)).toString('base64'))")"
pw="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network qr-search_default --env-file .env \
  -e APP_ENV= -e DATABASE_URL="postgresql://qr:${pw}@db:5432/qr" \
  -e BASIC_AUTH_USER="$USER_NAME" -e BASIC_AUTH_HASH_B64="$hash" -e ADMIN_USER="$USER_NAME" \
  -e WEBAUTHN_RP_ID=localhost -e WEBAUTHN_ORIGIN="$BASE" \
  --memory 1600m -p "127.0.0.1:${PORT}:3000" "$TAG" </dev/null >/dev/null
for _ in $(seq 1 60); do
  curl -s -o /dev/null -u "$USER_NAME:$PASS" -c "$jar" -b "$jar" -L "$BASE/login" && break
  sleep 1
done

bench() {
  curl -s -u "$USER_NAME:$PASS" -b "$jar" -c "$jar" "$@"
}

echo "==> サーバのベンチ × $SERVER_RUNS"
for n in $(seq 1 "$SERVER_RUNS"); do
  bench -H "Origin: $BASE" -H 'Content-Type: application/json' -X POST -d '{"kind":"server"}' "$BASE/api/diag/bench" >/dev/null
  sleep 2
  for _ in $(seq 1 200); do
    status="$(bench "$BASE/api/diag/bench")"
    jq -e '.data.running == null' <<<"$status" >/dev/null && break
    sleep 3
  done
  jq '.data.server' <<<"$status" >"$OUT/server-run$n.json"
  echo "    $n: $(jq -c '[.items[] | [.id, .medianMs]]' "$OUT/server-run$n.json")"
done

echo "==> ブラウザ側"
PROFILE_BASE_URL="$BASE" PROFILE_USER="$USER_NAME" PROFILE_PASS="$PASS" \
  npx tsx scripts/profileBrowser.ts "$OUT/browser.json" 6 </dev/null >/dev/null

echo "==> 重い処理のピーク"
./scripts/profilePeakMemory.sh "$OUT/peak-memory.json" 6 >/dev/null 2>&1

echo "==> 要約"
node scripts/summarizeProfile.mjs "$OUT"
