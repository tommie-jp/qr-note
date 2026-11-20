# PGroonga 入り PostgreSQL の自前ビルド。
#
# 公式 groonga/pgroonga:<ver>-alpine-18 は PostgreSQL の小版が出ても作り直されない
# (4.1.0-alpine-18 は 2026-10-09 のビルドで PG 18.6 のまま)。PG の小版はセキュリティ
# 修正を含むので、公式の Dockerfile (github.com/pgroonga/docker alpine/18、commit
# 0654f9d) を写し、土台の postgres だけを上げて自分で作る。
#
# 公式からの差分:
#   1. 土台を postgres:18-alpine (浮動) → 版と digest で固定
#   2. build.sh で落とすソースを sha256 で照合する (署名は手元で検証済み。build.sh 参照)
#   3. build.sh を set -euo pipefail に (と、公式の rm -f build.sh が / を消せていないのを /build.sh に)
#
# 版を上げる手順 (PG の小版が出たら):
#   1. FROM の版と digest を差し替える
#        docker buildx imagetools inspect postgres:18.X-alpine3.YY
#      Alpine の版は公式イメージに合わせる (apk の clang20/llvm20 が揃っている版)
#   2. compose.yaml の db.image のタグを上げる
#   3. ./doPgroongaImage.sh [--demo]  (ビルドしてサーバへ送り、db を作り直す)
#
# PGroonga / Groonga の版を上げるときは ENV と build.sh の sha256 を両方直す。

FROM postgres:18.7-alpine3.24@sha256:ff64c9e3bdf8e2120107d3559de8db314e8305f7e38c5105903c6295876738ff

ENV PGROONGA_VERSION=4.1.0 \
    GROONGA_VERSION=16.1.3

COPY build.sh /
RUN \
  apk add --no-cache --virtual=.build-dependencies \
    apache-arrow-dev \
    build-base \
    clang20-dev \
    cmake \
    gettext-dev \
    linux-headers \
    llvm20 \
    lz4-dev \
    meson \
    msgpack-c-dev \
    rapidjson-dev \
    ruby \
    samurai \
    xsimd-dev \
    xxhash-dev \
    zlib-dev \
    zstd-dev && \
  /build.sh ${PGROONGA_VERSION} ${GROONGA_VERSION} && \
  rm -f /build.sh && \
  apk del .build-dependencies && \
  apk add --no-cache \
    libarrow \
    libgomp \
    libxxhash \
    msgpack-c \
    zlib \
    zstd
