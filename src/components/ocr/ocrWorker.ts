// OCR の実体を載せる Web Worker (docs/24-画像OCR計画.md §9-1)。
//
// PaddleOCR 公式ブラウザ SDK (OpenCV.js 内蔵) + onnxruntime-web + モデル 21MB を
// **この realm の中だけ**で抱える。メインスレッドから terminate すれば realm ごと
// 消えるので、確保した wasm ヒープが OS へ返る。
//
// **なぜ realm ごと捨てる必要があるか**: WebAssembly.Memory は grow しかできず、
// SDK の dispose() で ORT セッションを release してもヒープの高水位は縮まない。
// メインスレッドで OCR を実行していた頃は、編集画面を離れても数百 MB がタブに
// 残り続け、後から開いた画像検索がモデルを積めずに落ちていた (実機 iPhone)。
// dispose() だけでは足りず、むしろ作り直しでヒープが伸びて悪化した (v0.18.0)。
//
// **SDK の worker モードを使わない理由**: SDK 自身も worker: true を持つが、
// そちらは自前 fetch を渡せず、モデル DL の進捗 % が出せなくなる。自前 Worker
// なら fetch はこの realm のものをそのまま使えるので、% は postMessage で
// メインスレッドへ中継できる。
//
// パイプラインの組み立てそのものは ocrPipeline.ts (メインスレッドの
// フォールバックと共通)。この realm 固有なのは shim・ログ拾い・メッセージ処理。

/// <reference lib="webworker" />

import { type CaptureScope, installClientLogCapture } from '@/lib/logging/clientCapture'
import { sendClientLogs } from '@/lib/logging/clientTransport'
import { createOcrService, ocrWithService, type OcrSdkService } from './ocrPipeline'
import type { FromOcrWorker, ToOcrWorker } from './ocrWorkerMessages'

const ctx = self as unknown as DedicatedWorkerGlobalScope

// Worker の console はどこにも出ないまま消える (docs/30-ブラウザログ計画.md §3)。
// モデル読み込みの失敗はこの中で起きるので、embedWorker と同じ拾い手を掛ける
installClientLogCapture({
  scope: ctx as unknown as CaptureScope,
  send: sendClientLogs,
})

// **SDK を Worker で動かすための最小の shim**。
//
// SDK の bitmapToSourceMat は認識のたびに `document.createElement("canvas")` を
// 呼び、そこに描いてから cv.imread に渡す。Worker では
// ReferenceError: document is not defined で落ちる (実測)。
//
// 代わりに OffscreenCanvas を返す。これで足りる根拠:
//   - SDK 自身の worker モード (dist/assets/worker-entry-*.js) が同じ変換を
//     `new OffscreenCanvas(w, h)` で行っている = 上流が想定している経路
//   - 同梱の OpenCV.js は imread で `img instanceof OffscreenCanvas` を分岐して
//     受け付ける
//   - SDK が canvas に対して使うのは width/height・getContext('2d')・drawImage
//     だけで、いずれも OffscreenCanvas にある
//
// canvas 以外の要素を求められたら、想定と違う経路に入った合図なので落とす。
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  ;(globalThis as { document?: unknown }).document = {
    createElement(tagName: string) {
      if (tagName !== 'canvas') {
        throw new Error(`OCR Worker では <${tagName}> を作れません`)
      }
      return new OffscreenCanvas(1, 1)
    },
  }
}

// 同梱 OpenCV.js の imread は `img instanceof HTMLImageElement` を先に見てから
// OffscreenCanvas の分岐に落ちる。Worker には HTMLImageElement が無いので
// instanceof の時点で ReferenceError になる (実測)。**渡すのは常に
// OffscreenCanvas なので、false になりさえすればよい**。素の class を置いて
// 分岐を素通りさせる
for (const name of ['HTMLImageElement', 'HTMLCanvasElement'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    ;(globalThis as Record<string, unknown>)[name] = class {}
  }
}

// この realm で 1 度だけ初期化する。**失敗もラッチする** — 落ちた realm で
// もう一度試すと 21MB のモデル取得ごとやり直しになるだけで、作り直すか
// どうかはメインスレッド側 (ocrService) が決める (Worker を作り直す /
// メインスレッドへフォールバック)。
let servicePromise: Promise<OcrSdkService> | null = null
let initFailed = false

function post(message: FromOcrWorker): void {
  ctx.postMessage(message)
}

function getService(): Promise<OcrSdkService> {
  if (!servicePromise) {
    servicePromise = createOcrService((percent) =>
      post({ type: 'model-progress', percent }),
    )
  }
  return servicePromise
}

ctx.onmessage = async (event: MessageEvent<ToOcrWorker>) => {
  const msg = event.data

  if (msg.type === 'preload') {
    try {
      await getService()
      post({ type: 'ready' })
    } catch (err) {
      initFailed = true
      post({ type: 'load-error', message: String(err) })
    }
    return
  }

  // type === 'ocr'
  if (initFailed) {
    // 落ちた realm で取り直さない (上のコメント参照)。メイン側が
    // 作り直し/フォールバックを進めている間に届いた要求もこれで返る
    post({ type: 'load-error', message: 'OCR の初期化に失敗しています' })
    return
  }
  let service: OcrSdkService
  try {
    service = await getService()
  } catch (err) {
    initFailed = true
    post({ type: 'load-error', message: String(err) })
    return
  }
  try {
    const quote = await ocrWithService(service, msg.blob)
    post({ type: 'ready' })
    post({ type: 'result', id: msg.id, quote })
  } catch (err) {
    // 1 枚だけの失敗 (壊れた画像など)。service は生きているので捨てない
    post({ type: 'error', id: msg.id, message: String(err) })
  }
}
