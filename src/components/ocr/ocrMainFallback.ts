// OCR のメインスレッド・フォールバック (docs/24-画像OCR計画.md §9-2)。
//
// 本命は Worker (ocrWorker.ts)。ただし **Worker で SDK を組めない環境がある**:
// 実測は Windows Chrome (JS ヒープ上限 1120MB・WebGPU アダプタ無しの constrained
// 環境) で、OpenCV + onnxruntime を載せた Worker realm が認識モデルの 16.5MB を
// 確保できず "Can't create a session. failed to allocate a buffer" で落ちた。
// 同じ機械のメインスレッドでは v0.18.0 まで同じ構成が動いていた実績があるため、
// Worker が 2 度 (初回 + 作り直し) 失敗したときだけここへ落とす。
//
// **トレードオフ**: メインスレッドの wasm ヒープは解放できない (realm を捨て
// られない) ので、v0.18.0 以前の「居座り」がこの環境にだけ戻る。認識中は
// メインスレッドも塞がる。それでも「OCR が使えない」よりはよい。
// iPhone は Worker で動くのでここへは来ない。
//
// singleton は解放しない (できない)。ocrService の disposeOcr は Worker 側
// だけを扱い、ここは page の寿命と運命を共にする。

import { createOcrService, ocrWithService, type OcrSdkService } from './ocrPipeline'

let servicePromise: Promise<OcrSdkService> | null = null

// 画像 1 枚を OCR する。進捗 % は呼び手 (ocrService) の購読チャネルへ流す。
// 初期化の失敗は投げる。promise を捨てておけば次の呼び出しで取り直せる
// (Worker と違い、メインスレッドの失敗は回線起因が主で、環境起因なら
// どのみち打つ手がない)。
export async function ocrOnMainThread(
  blob: Blob,
  onDownloadPercent: (percent: number) => void,
): Promise<string> {
  if (!servicePromise) {
    servicePromise = createOcrService(onDownloadPercent)
  }
  let service: OcrSdkService
  try {
    service = await servicePromise
  } catch (err) {
    servicePromise = null
    throw err
  }
  return ocrWithService(service, blob)
}
