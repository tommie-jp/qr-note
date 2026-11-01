// Content-Security-Policy の組み立て (2026-11 のセキュリティ監査 M-1)。
//
// ノート本文 (Markdown・mermaid・KaTeX・各フェンスの SVG) を DOM に挿す
// アプリなので、個々のサニタイズが漏れたときの第二の防壁として、**スクリプトは
// 「この応答のために作った nonce を持つもの」と自分のオリジンのファイルだけ**に
// 絞る。nonce は proxy.ts が要求ごとに作り、Next.js 自身の inline script は
// 要求ヘッダの CSP から nonce を拾って自分で付ける (Next 16 同梱ガイド
// 01-app/02-guides/content-security-policy.md)。自前の inline script は
// components/chrome/PreHydrationScripts.tsx の 2 本だけで、layout が nonce を渡す。
//
// この階層は純粋 (next/server も node:crypto も読まない)。proxy と layout と
// publicPaths の 3 か所から読まれる。
//
// 緩めてある所と理由:
//   style-src 'unsafe-inline' … React の style 属性・KaTeX・mermaid の <style>・
//                               layout の html style。守りたいのはスクリプト側
//   img-src / media-src https: … ノートの外部画像は直リンク (docs/105)
//   connect-src の HF … 画像検索のモデル (Xenova/dinov2-small) はブラウザが
//                        huggingface.co から取り、CDN (*.hf.co) へ 302 する
//   'wasm-unsafe-eval'       … onnxruntime-web・zxing-wasm・pdfjs・libheif
//   worker-src blob:         … onnxruntime-web が blob: の Worker を立てる
//   frame-src 'self'         … 「図を編集」の殻 (sandbox の srcdoc iframe)。
//                              **'strict-dynamic' は付けない** — srcdoc は親の
//                              CSP を継承し、殻の <script src=/fence/map.web.js>
//                              が nonce 違いで落ちる (Chromium で実測)
//   'unsafe-eval' (開発だけ) … React が開発時に eval でスタックを組み立てる

export const CSP_HEADER = 'Content-Security-Policy'
// proxy → layout へ nonce を運ぶ要求ヘッダ (Next のガイドと同じ名前)
export const NONCE_HEADER = 'x-nonce'
// 違反の報告先 (app/api/csp-report/route.ts)。未ログインの頁からも飛ぶので公開パス
export const CSP_REPORT_PATH = '/api/csp-report'
export const REPORTING_ENDPOINTS_HEADER = 'Reporting-Endpoints'
export const REPORTING_ENDPOINT_NAME = 'csp'

// 画像検索のモデルの取得先 (embedding/model.ts の EMBEDDING_MODEL_ID を
// transformers.js が既定のホストから取る)。resolve → CDN への 302 の両方が
// connect-src に当たるので、CDN のワイルドカードも要る
const MODEL_HOSTS = ['https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co']

export interface CspOptions {
  readonly nonce: string
  // next dev (React が eval を使う) のときだけ true
  readonly isDev: boolean
}

export function contentSecurityPolicy({ nonce, isDev }: CspOptions): string {
  const directives: readonly string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    // blob: と data: は、pdfjs (PDF の見本・ビューア) や画像処理が手元の Blob を
    // fetch で読み直すのに要る (E2E で実測)。外へは出ない
    `connect-src 'self' blob: data: ${MODEL_HOSTS.join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${REPORTING_ENDPOINT_NAME}`,
  ]
  return directives.join('; ')
}

export function reportingEndpointsHeader(): string {
  return `${REPORTING_ENDPOINT_NAME}="${CSP_REPORT_PATH}"`
}

// 128bit の乱数を base64 に。Web Crypto は Node の proxy でも使える
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
