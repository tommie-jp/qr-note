import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 用の自己完結ビルド (.next/standalone)
  output: "standalone",
  // 画面遷移のアニメーション (docs/11-アプリ的UIUX計画.md §4)。
  // experimental なので、壊れたらこの 1 行と layout.tsx の <ViewTransition> を
  // 外せば元に戻る。非対応ブラウザではアニメーションなしで普通に動く
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
    // **値は uploads.ts の checkUploadRequest の門と同じにする** =
    // maxUploadBytes() (動画 30MB) + MULTIPART_OVERHEAD_BYTES (1MB)。揃えると
    // 「本文が切られるのは 413 で断った後だけ」になり、切られた本文が route に
    // 届くことがなくなる。片方だけ動かすと上の不具合が戻るので、
    // src/lib/uploads.test.ts が両者の一致を見張っている。
    //
    // これ以上は上げない。ここはメモリに載る量そのもので、本番 VPS は RAM 2GB
    // (docs/09-vps振り分け移行手順.md)。500MB を流す ZIP 取り込みは、複製
    // させないために proxy の matcher から外してある (src/proxy.ts)。
    proxyClientMaxBodySize: 31 * 1024 * 1024,
  },
  turbopack: {
    // OCR の公式 SDK (@paddleocr/paddleocr-js) には、ブラウザでは通らない分岐が
    // 残っている:
    //   - 同梱の OpenCV.js (Emscripten) が Node 判定の中で require("fs")
    //   - 同梱の worker 用アセットが onnxruntime の proxy worker
    //     (ort.bundle.min.mjs) を import.meta.url 相対で探す
    // どちらも実行時には踏まない (ブラウザで動かし、worker モードも使わない。
    // ocrService.ts は worker 未指定) が、Turbopack は静的解析で追いかけて
    // 解決できずにビルドを落とす。SDK 配下に限って未解決を無視する。
    //
    // 範囲を dist/assets/ だけに絞ると OpenCV.js 側 (SDK の node_modules に
    // ネストしている) が漏れてビルドが落ちる。SDK 全体を対象にする必要がある。
    // path は glob だとマッチしなかったため RegExp で書く。
    ignoreIssue: [{ path: /paddleocr-js/ }],
  },
  // node-tikzjax は TeX の core dump などを __dirname 相対で読むため、
  // バンドルせず素のパッケージのまま standalone へ運ばせる。
  // src/lib/circuitikz.ts の _traceNodeTikzjax がこれと対で効く。
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
