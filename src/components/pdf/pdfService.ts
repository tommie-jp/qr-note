// PDF ビューアの下回り (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// **なぜ自前ビューアか**: ホーム画面から起動した iOS PWA (standalone) では
// target="_blank" が効かず、同じ webview がそのまま PDF に遷移する。standalone
// には URL バーも戻るボタンも無いため、アプリを強制終了するまでノートへ戻れない
// (実機で確認)。ページ内にモーダルで描けば**遷移そのものが起きない**ので、
// 閉じるだけで確実に戻れる。iOS の <iframe> 埋め込みは 1 ページ目しか描かない
// WebKit の既知バグがあるため、canvas に自前で描く。
//
// pdfjs 本体 (worker 込みで数 MB) はモーダルを開くまで読み込まない。
// import() を関数の中に置くことで、本文表示のバンドルには乗らない
// (OCR の ocrService.ts と同じ流儀)。
//
// このモジュールはブラウザでのみ呼ぶ。サーバ側からは絶対に import しないこと。

import { pageRenderScale } from '@/lib/pdf/pdfScale'

// worker とアセットは scripts/assets.mjs が public/pdfjs/ へ複製する。
// CDN も import.meta.url 相対も使わない (外部依存を作らない / Turbopack が
// worker の相対解決を追えずビルドを落とすため)。
const ASSET_BASE = '/pdfjs/'
const WORKER_SRC = `${ASSET_BASE}pdf.worker.min.mjs`

type PdfjsModule = typeof import('pdfjs-dist')

// 一度読んだモジュールは使い回す (worker は文書ごとに立つので、ここで
// 抱えても文書を閉じればメモリは返る)
let pdfjsPromise: Promise<PdfjsModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = WORKER_SRC
    return lib
  })
  return pdfjsPromise
}

export interface PdfPageSize {
  width: number
  height: number
}

export interface PdfDocumentHandle {
  numPages: number
  // ページの寸法 (倍率 1)。canvas の場所取りを描画前に決めるために使う
  pageSize(pageNumber: number): Promise<PdfPageSize>
  // ページを canvas へ幅フィットで描く。既に走っている描画があれば中断する。
  renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
  ): Promise<void>
  // ページのテキストを canvas の上へ透明な span として重ねる。
  // これで選択・コピー・ブラウザ内検索・読み上げが効くようになる
  // (canvas だけだと絵にしか見えない)。
  renderTextLayer(
    pageNumber: number,
    container: HTMLElement,
    cssWidth: number,
  ): Promise<void>
  // そのページの描画が走っていれば中断する。画面外へ出た canvas を
  // 解放する前に呼ぶ (描き込み中の canvas を 0 幅にしない)
  cancelPage(pageNumber: number): void
  // PDF の生バイト列。共有シートへ渡すのに使う。
  // **表示のために既に読み込んだものを返す**ので、取り直しの通信は起きない
  // (共有はユーザー操作の直後に呼ぶ必要があり、間に fetch を挟むと
  // iOS が transient activation 切れで弾く)
  getData(): Promise<Uint8Array>
  // worker ごと破棄する。**閉じたら必ず呼ぶこと** — wasm ヒープは縮まないので、
  // 抱えたままだと後から開く OCR や画像検索がモデルを積めずに落ちる
  // (ocrService.ts の disposeOcr と同じ理由)
  destroy(): Promise<void>
}

// 描画が中断されたときに pdfjs が投げる例外か。中断は正常系 (閉じた・作り直した)
// なのでエラーとして扱わない
export function isRenderCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'RenderingCancelledException'
  )
}

// PDF を読み込む。認証は Cookie で、同一オリジンなので既定の fetch に付く。
// 配信側 (api/images/[name]) は Range 対応済みなので、pdfjs は必要な範囲だけ取る。
export async function loadPdfDocument(url: string): Promise<PdfDocumentHandle> {
  const lib = await loadPdfjs()

  const task = lib.getDocument({
    url,
    // 日本語 PDF は Adobe-Japan1 などの定義済み CMap を参照する。
    // これが無いと本文が空白や豆腐になる
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    // フォントを埋め込んでいない PDF (標準 14 フォント) 用
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    // JBIG2 / JPEG2000 の画像デコードと色管理
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
  })

  // PDF 内 JavaScript (AcroForm のスクリプト) はここでは動かない。実行には
  // pdfjs のビューア層 (PDFViewer + scripting sandbox) が要るが、このアプリは
  // getDocument と page.render しか使わないため入口が無い。加えて
  // scripts/assets.mjs が quickjs-eval を複製しないので、仮に呼ばれても動かない

  const doc = await task.promise
  // ページごとの描画タスク。同じページへ描き直すときに前のを中断する
  const tasks = new Map<number, { cancel: () => void }>()
  const textLayers = new Map<number, { cancel: () => void }>()

  return {
    numPages: doc.numPages,

    async pageSize(pageNumber) {
      const page = await doc.getPage(pageNumber)
      const { width, height } = page.getViewport({ scale: 1 })
      return { width, height }
    },

    async renderPage(pageNumber, canvas, cssWidth) {
      tasks.get(pageNumber)?.cancel()

      const page = await doc.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const scale = pageRenderScale(
        base.width,
        base.height,
        cssWidth,
        // SSR では触れない値なので、ここ (クライアント実行) で読む
        globalThis.devicePixelRatio ?? 1,
      )
      const viewport = page.getViewport({ scale })

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      // 実ピクセルは倍率ぶん大きいが、画面上は cssWidth に収める
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${Math.floor(viewport.height / (viewport.width / cssWidth))}px`

      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('canvas の 2D コンテキストを取得できませんでした')
      }

      const task = page.render({ canvas, canvasContext: context, viewport })
      tasks.set(pageNumber, task)
      try {
        await task.promise
      } finally {
        if (tasks.get(pageNumber) === task) {
          tasks.delete(pageNumber)
        }
      }
    },

    async renderTextLayer(pageNumber, container, cssWidth) {
      textLayers.get(pageNumber)?.cancel()

      const page = await doc.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      // **canvas とは倍率が違う**。canvas は DPR を掛けた実ピクセルで描くが、
      // テキストは CSS ピクセル上に置くので、画面上の見た目の倍率で組む。
      // 混同すると文字の当たり判定が絵とずれる
      const scale = cssWidth / base.width
      const viewport = page.getViewport({ scale })

      container.replaceChildren()
      // 倍率を先に入れてから TextLayer を作る。TextLayer は内部で
      // setLayerDimensions を呼び、container の width/height を
      //   round(down, var(--total-scale-factor) * <ページ寸法>px, var(--scale-round-x))
      // という式で**上書きする**。--total-scale-factor と --scale-round-x/y の
      // 両方が要り、欠けると式ごと無効になる (globals.css の .textLayer が
      // --scale-round-x/y を持つ。こちらは倍率を入れる)
      container.style.setProperty('--total-scale-factor', String(scale))

      const layer = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      })
      textLayers.set(pageNumber, layer)
      try {
        await layer.render()
      } finally {
        if (textLayers.get(pageNumber) === layer) {
          textLayers.delete(pageNumber)
        }
      }
    },

    cancelPage(pageNumber) {
      tasks.get(pageNumber)?.cancel()
      tasks.delete(pageNumber)
      textLayers.get(pageNumber)?.cancel()
      textLayers.delete(pageNumber)
    },

    getData() {
      return doc.getData()
    },

    async destroy() {
      for (const running of tasks.values()) {
        running.cancel()
      }
      tasks.clear()
      for (const layer of textLayers.values()) {
        layer.cancel()
      }
      textLayers.clear()
      await task.destroy()
    },
  }
}
