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

# 依存レイヤーは **版番号を潰した写し** (.deps/) から入れる。
# 素の package.json を使うと、doVersion.sh が版を上げるたびにこの層が無効化され、
# 依存が 1 つも変わっていないのに npm ci が毎デプロイ走り直す (実測 20.7 秒)。
# 詳細と生成は scripts/writeDepsManifest.mjs、経緯は docs/80-デプロイ再高速化計画.md。
#
# .deps/ は git 管理外の生成物。doDeploy.sh と doStart.sh がビルド前に必ず作る。
# 手で `docker compose build` する場合は先に次を実行すること:
#   node scripts/writeDepsManifest.mjs
COPY .deps/package.json .deps/package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
# postinstall (prisma generate) はソースコピー後に明示実行するためスキップ
RUN npm ci --ignore-scripts

# ここで実体の package.json (正しい版) が上書きされる。フッターへ焼き込まれる
# 版はこちらなので、依存レイヤーの 0.0.0 が外へ出ることはない
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
#
# ビルド後に**層の割り当てを整える** (docs/80-デプロイ再高速化計画.md §S2/§S3)。
# どちらも最終イメージの中身は 1 バイトも変えない。「毎回変わる層」に混ざって
# いた不変の大物を、別の (変わらない) 層へ追い出すだけ。
#
#   1. .next/standalone/public を捨てる
#      Next の公式ドキュメントは「standalone は public をコピーしない」と書いて
#      いるが、実際は file tracing が public/ を 369 ファイル辿って取り込む
#      (入口は埋め込み用の ort-wasm-*.mjs)。すると **178.9MB のモデル群が
#      standalone 層に同居**し、この層は毎ビルド変わるので毎回 push される。
#      public は下の COPY が別層で入れるので、ここで消しても最終的な /app/public
#      は同一。二重同梱も同時に解消してイメージが 59MB 縮む。
#
#   2. .next/static/media を切り出す
#      中身はフォント 60 個 (61MB / gzip 19.2MB)。ファイル名が内容ハッシュなので
#      **不変**なのに、毎ビルド変わる chunks と同じ層にいて毎回送られていた。
#      別ディレクトリへ退避し、runner 側で別々の COPY にして層を分ける。
#
#   3. standalone/node_modules を切り出す
#      トレースされた依存 (74MB / gzip 33MB)。**依存を変えない限り不変**なのに、
#      毎ビルド変わる .next/server と同じ層にいて毎回送られていた。同じ手で分ける。
#      最終的な置き場は同じ /app/node_modules なので server.js の解決は変わらない。
RUN npm run build \
 && rm -rf .next/standalone/public \
 && mkdir -p /static-media \
 && mv .next/static/media /static-media/media \
 && mkdir -p /standalone-nm \
 && mv .next/standalone/node_modules /standalone-nm/node_modules

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

# 並びは「変わらないものほど先」。レジストリは層ごとに blob を内容で持つので、
# 不変の層 (node_modules / media / public) は 2 回目以降の push で「既に存在」で飛ぶ。
# 毎回変わるのは下 2 つ (.next/static の chunks と standalone の server 出力) だけ。
COPY --from=builder /standalone-nm/node_modules ./node_modules
COPY --from=builder /static-media/media ./.next/static/media
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./

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
