# ビルドステージ: 依存インストール + Prisma 生成 + Next.js standalone ビルド
#
# ベースは alpine ではなく slim (Debian) を使う。画像検索のサーバ側埋め込み
# (@huggingface/transformers → onnxruntime-node) はネイティブの glibc ビルド
# しか配布されておらず、alpine (musl) では .so が揃っていても
# 「Error loading shared library ld-linux-x86-64.so.2」で読めない (実測)。
# builder と runner は必ず同じ libc にする (sharp 等のネイティブ依存は
# npm ci 時の libc で選ばれるため、片方だけ変えると壊れる)
FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall (prisma generate) はソースコピー後に明示実行するためスキップ
RUN npm ci --ignore-scripts

COPY . .
# ビルド時のページデータ収集で db.ts が import されるためダミー URL を渡す
# (全ページ force-dynamic なので実際の接続は起きない。実行時は compose が上書き)
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
# npm run build = tikzjax フォント + zxing wasm の複製 + prisma generate + next build
#
# 注: レイヤーの再現性 (public 188MB・onnx 35MB を毎デプロイ再送しないための mtime 固定)
# は、doDeploy.sh 側が buildx の rewrite-timestamp + SOURCE_DATE_EPOCH で全レイヤーに
# 一括適用する。ここで個別に touch する必要はない (親ディレクトリ app/ の mtime までは
# Dockerfile 内 touch では固定できず、結局レイヤーが変わってしまうため)。
RUN npm run build

# 実行ステージ: standalone 出力のみの最小イメージ (builder と同じ libc に揃える)
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# ノート履歴 (docs/57-ノートgit履歴計画.md) の git 本体と、リポジトリの置き場。
# 置き場は named volume (compose.yaml の git-notes) のマウント先。volume は
# 初回マウント時にイメージ側ディレクトリの所有権を引き継ぐため、ここで
# node 所有にしておかないと USER node で書けない。
# COPY より前に置くのはレイヤーキャッシュのため (ソースが変わっても apt を
# 引き直さない)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/data/git-notes \
 && chown -R node:node /app/data

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# onnxruntime-node の共有ライブラリを standalone に補う。
# Next のトレースは require で辿れる onnxruntime_binding.node は運ぶが、
# その DT_NEEDED (動的リンカが読む依存) である libonnxruntime.so.1 は JS から
# 参照が見えず、置いていかれる — すると実行時に
# 「Error loading shared library libonnxruntime.so.1」で埋め込み生成が落ちる。
# glob なのは、npm ci --ignore-scripts では CUDA 用 .so (315MB、install script
# が別途落とす) が存在しないため。存在するもの (本体 35MB + providers_shared)
# だけを運ぶ
COPY --from=builder /app/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime*.so* ./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/

USER node
EXPOSE 3000
CMD ["node", "server.js"]
