import type { NextConfig } from "next";
import { MAX_VIDEO_BYTES, MULTIPART_OVERHEAD_BYTES } from "./src/lib/uploads/limits";

const nextConfig: NextConfig = {
  // Docker 用の自己完結ビルド (.next/standalone)
  output: "standalone",
  // 型検査はビルドから切り離し、`npm run typecheck` が受け持つ
  // (docs/80-デプロイ再高速化計画.md §9-2)。
  //
  // なぜ外すか: next build の中の型検査は**単スレッドで 4.7 秒**あり、
  // Turbopack のコンパイル (多コアで 4.9 秒) の後に直列で積まれていた。
  // ./doDeploy.sh の 3/8 は lint / typecheck / test / build を並列に流すので、
  // ビルドの中から出して 4 本目のレーンに移すと、その 4.7 秒は他のレーンの
  // 裏に隠れて丸ごと消える (typecheck 自体は約 2.2 秒)。
  //
  // **検査を捨てたわけではない。** `npm run typecheck` は
  // `next typegen && tsc --noEmit` で、next build が使うのと同じ
  // .next/types/validator.ts (ページ・レイアウト・route handler の
  // 署名を経路ごとに検査する生成物) を先に作り直してから tsc を回す。
  // typegen を省くと、経路を足した日に**古い一覧のまま検査が通ってしまう**。
  //
  // 注意: これで `npm run build` 単体 (./doStart.sh 経由を含む) は型エラーで
  // 落ちなくなる。手で建てるときは `npm run typecheck` を別に流すこと。
  typescript: {
    ignoreBuildErrors: true,
  },
  // 画面遷移のアニメーション (docs/11-アプリ的UIUX計画.md §4)。
  // experimental なので、壊れたらこの 1 行と src/components/PageTransition.tsx の
  // <ViewTransition> (各ページが <PageTransition> で包んでいる) を外せば元に戻る。
  // layout ではなくページごとに置く理由は PageTransition.tsx の注。
  // 非対応ブラウザではアニメーションなしで普通に動く
  experimental: {
    viewTransition: true,
    // proxy (src/proxy.ts) を通るルートは、Next.js が本文をメモリへ丸ごと
    // 複製する (proxy と route handler の両方で読めるようにするため)。
    // **超えたぶんは黙って捨てられる** — 応答はエラーにならず、警告が 1 行
    // 出るだけで、route handler には途中で切れた本文が届く
    // (node_modules/next/dist/server/body-streams.js の getCloneableBody)。
    //
    // 既定の 10MB のままだと、動画 (最大 30MB) がここで千切れる。route の
    // formData() は「境界の閉じない multipart」として落ち、ユーザーには
    // 「multipart/form-data で file を送信して下さい」という見当違いの 400 しか
    // 出ない — 本当の理由 (本文が途中で捨てられた) がどこにも出ない。
    //
    // **値は uploads/request.ts の checkUploadRequest の門と同じにする** =
    // maxUploadBytes() (動画 30MB) + MULTIPART_OVERHEAD_BYTES (1MB)。揃えると
    // 「本文が切られるのは 413 で断った後だけ」になり、切られた本文が route に
    // 届くことがなくなる。片方だけ動かすと上の不具合が戻るので、
    // 手で書き写さず uploads/limits.ts の定数から導き、src/lib/uploads/request.test.ts
    // が maxUploadBytes() との一致を見張る (動画より大きい種別が増えたらそこで落ちる)。
    //
    // maxUploadBytes() そのものを呼ばないのは、DEMO_MODE で値が変わる関数だから。
    // ここはデモでも 31MB のまま (デモの門 3MB より大きいので本文は切られない)。
    // import できるのは uploads/limits.ts の依存 (appEnv) が副作用なしの
    // 相対 import だけだから。Next は next.config.ts を SWC + require フックで
    // 読む (--experimental-next-config-strip-types は使っていない)。
    //
    // これ以上は上げない。ここはメモリに載る量そのもので、本番 VPS は RAM 2GB
    // (41-QR-search/docs/09-vps振り分け移行手順.md)。500MB を流す ZIP 取り込みは、複製
    // させないために proxy の matcher から外してある (src/proxy.ts)。
    proxyClientMaxBodySize: MAX_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES,
  },
  turbopack: {
    // OCR の公式 SDK (@paddleocr/paddleocr-js) には、ブラウザでは通らない分岐が
    // 残っている:
    //   - 同梱の OpenCV.js (Emscripten) が Node 判定の中で require("fs")
    //   - 同梱の worker 用アセットが onnxruntime の proxy worker
    //     (ort.bundle.min.mjs) を import.meta.url 相対で探す
    // どちらも実行時には踏まない (ブラウザで動かし、worker モードも使わない。
    // ocrService.ts は worker 未指定) が、Turbopack は静的解析で追いかけて
    // 解決できずにビルドを落とす。
    //
    // 無視するのは**この 2 ファイルの、この 2 つの未解決だけ**
    // (docs/93-リファクタリング計画.md §2-5)。以前は SDK 全体 (/paddleocr-js/)
    // を黙らせていたため、SDK を上げて本物の解決漏れや別の破損が出ても
    // ビルドが通ってしまった。絞っておけば、SDK 側でファイル名や文言が変わった
    // 日にはビルドが落ちるので、そのとき中身を確かめて書き直す
    // (worker-entry のハッシュ部分だけは版ごとに変わるので [^/]+ で受ける)。
    // OpenCV.js は SDK の node_modules にネストしている点に注意。
    //
    // 未解決の相手 ('fs' など) は title に「Module not found: Can't resolve 'fs'」
    // の形で入っている (実測。違う相手を書くとビルドが落ちることも確かめた)。
    // path は glob だとマッチしなかったため RegExp で書く。
    ignoreIssue: [
      {
        path: /\/@paddleocr\/paddleocr-js\/node_modules\/@techstark\/opencv-js\/dist\/opencv\.js$/,
        title: /Module not found: Can't resolve 'fs'/,
      },
      {
        path: /\/@paddleocr\/paddleocr-js\/dist\/assets\/worker-entry-[^/]+\.js$/,
        title: /Module not found: Can't resolve 'ort\.bundle\.min\.mjs'/,
      },
    ],
  },
  // node-tikzjax は TeX の core dump などを __dirname 相対で読むため、
  // バンドルせず素のパッケージのまま standalone へ運ばせる。
  // src/lib/circuit/circuitikz.ts の _traceNodeTikzjax がこれと対で効く。
  //
  // 画像検索の埋め込み (docs/25-画像検索計画.md) は Node 側で transformers.js を
  // 使い、その下回りの onnxruntime-node はネイティブ addon (.node) を持つ。
  // バンドルせず素のまま standalone へ運ばせる (native モジュールは webpack で
  // 束ねられない)。
  // heic-decode / libheif-js は libheif を WebAssembly でバンドルした
  // パッケージ。iPhone 標準の HEIC を保存時に WebP へ変換するために使う
  // (docs/26-画像形式対応計画.md §3)。sharp の prebuilt バイナリは HEVC を
  // 含まず HEIC を復号できないため、この WASM 復号器を別に持つ。
  // webpack で束ねると .wasm の解決が壊れるので素のまま standalone へ運ばせる。
  serverExternalPackages: [
    "node-tikzjax",
    "@huggingface/transformers",
    "onnxruntime-node",
    "heic-decode",
    "libheif-js",
  ],
  // /docs/memo・/docs/search が実行時に読む md を standalone に同梱する
  outputFileTracingIncludes: {
    "/docs/memo": ["./docs/**/*"],
    "/docs/search": ["./docs/**/*"],
    // 回路図の描画スクリプトは意図的に Next のバンドル対象外 (子プロセスで
    // 起動する素の CJS) なので、tracer からは見えない。明示的に同梱する。
    //
    // キーは picomatch のルート glob。[itemNo] を書くと文字クラスと解釈され、
    // どのルートにもマッチせず「黙って何も同梱されない」ためエスケープする
    "/item/\\[itemNo\\]": ["./scripts/renderCircuit.cjs"],
  },
  // Ver1 の旧 URL 互換。/item/:itemNo は同一パスで実装済みのため不要
  async redirects() {
    return [
      { source: "/config/:itemNo", destination: "/", permanent: false },
      { source: "/config", destination: "/", permanent: false },
      { source: "/search", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
