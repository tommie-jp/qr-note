// OCR パイプラインの共通実体 (docs/24-画像OCR計画.md §9-1)。
//
// Worker (ocrWorker.ts) とメインスレッドのフォールバック (ocrMainFallback.ts) が
// **同じ設定・同じ手順**で SDK を組み立てるための置き場。ここは副作用を持たない
// (import しただけでは何も起きない) — Worker 専用の shim やログ拾いは
// ocrWorker.ts 側に置く。

import { formatOcrQuote } from '@/lib/ocr/ocrQuote'
import { orderOcrItems } from '@/lib/ocr/orderOcrItems'
import { quietOrtSessionLogs } from '@/lib/ort/quietOrtLogs'
import { aggregatePercent } from '@/lib/progress/progress'
import { createProgressFetch } from '@/lib/progress/progressFetch'

// onnxruntime-web は既定で .wasm を CDN から取りに行く。自前配布した
// public/onnxruntime/ を指して外部依存を断つ (scripts/assets.mjs)。
const WASM_BASE_PATH = '/onnxruntime/'

// 日本語を含む統合モデル (PP-OCRv5 mobile)。日本語優先は認識後の正規化
// (normalizeToJapanese) で寄せる ②方式 (docs/24 §2)。
//
// SDK の既定は百度の CDN からモデルを直接取るが、そこは CORS ヘッダを返さず
// **ブラウザからは弾かれる** (実機で確認)。自前配布に差し替える
// (scripts/assets.mjs が public/paddle-ocr/ へ落とす)。
// モデル名は tar 内 inference.yml の model_name と一致していないと
// 初期化時に弾かれるので、スクリプト側のファイル名と対で変える。
const DET_MODEL_NAME = 'PP-OCRv5_mobile_det'
const REC_MODEL_NAME = 'PP-OCRv5_mobile_rec'
const MODEL_BASE_PATH = '/paddle-ocr/'

// モデル tar 2 本の合計バイト数 (det 4,843,520 + rec 16,701,440)。
// Content-Length が取れないときの進捗 % の分母に使う。モデルを差し替える
// ときは scripts/assets.mjs と対でここも更新する
// (ずれても % の見た目が狂うだけで動作には影響しない)
const MODEL_TOTAL_BYTES_FALLBACK = 21_544_960

// OCR に渡す画像の長辺の上限。アップロード保存は実質原寸 (webp の上限
// 16383px のみ) なので、iPhone の 12〜48MP 写真がそのまま入り得る。
// OpenCV の行列は「幅×高さ×4 バイト」を何面も持つため、原寸のまま通すと
// iOS WebKit のメモリ上限を超える。長辺 2048px なら行列 1 面 16MB 程度で、
// ラベル・書籍ページの印刷文字には足りる
const MAX_OCR_SIDE = 2048

type SdkModule = typeof import('@paddleocr/paddleocr-js')
export type OcrSdkService = Awaited<ReturnType<SdkModule['PaddleOCR']['create']>>

// モデル由来の ORT 警告で /logs と eruda が埋まるのを止める。
// 理由と仕組みは quietOrtLogs.ts に書いた。**セッションを作る前に**呼ぶこと。
async function quietenOrtWarnings(): Promise<void> {
  const ort = await import('onnxruntime-web')
  quietOrtSessionLogs(ort)
}

// SDK を組み立てる。モデル tar の受信バイトを数えて DL 進捗 % を
// onDownloadPercent へ流す (aggregatePercent は 99 で頭打ち。create の解決が
// 真の完了)。
export async function createOcrService(
  onDownloadPercent: (percent: number) => void,
): Promise<OcrSdkService> {
  await quietenOrtWarnings()
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js')

  return PaddleOCR.create({
    textDetectionModelName: DET_MODEL_NAME,
    textDetectionModelAsset: { url: `${MODEL_BASE_PATH}${DET_MODEL_NAME}.tar` },
    textRecognitionModelName: REC_MODEL_NAME,
    textRecognitionModelAsset: { url: `${MODEL_BASE_PATH}${REC_MODEL_NAME}.tar` },
    fetch: createProgressFetch((downloads) =>
      onDownloadPercent(aggregatePercent(downloads, MODEL_TOTAL_BYTES_FALLBACK)),
    ),
    ortOptions: {
      // wasm に固定する。'auto' は WebGPU が見えると WebGPU を選ぶが、
      // iOS WebKit の WebGPU はメモリを余分に食い、挙動もまだ枯れていない
      backend: 'wasm',
      wasmPaths: WASM_BASE_PATH,
    },
  })
}

// 大きすぎる画像を OCR 用に縮める。上限以下ならそのまま返す。
async function toOcrBitmap(blob: Blob): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob)
  const side = Math.max(bitmap.width, bitmap.height)
  if (side <= MAX_OCR_SIDE) {
    return bitmap
  }
  const scale = MAX_OCR_SIDE / side
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  })
  bitmap.close()
  return resized
}

// 画像 1 枚を OCR し、日本語優先で整えた引用ブロックを返す。
// 文字が取れなければ空文字 (呼び手はこれを「見つからなかった」に使う)。
export async function ocrWithService(
  service: OcrSdkService,
  blob: Blob,
): Promise<string> {
  // 原寸ではなく縮小した ImageBitmap を渡す (MAX_OCR_SIDE の理由を参照)。
  // 返るのは入力 1 枚につき 1 要素の配列。
  //
  // 検出段はさらに長辺 960 まで縮めて掛ける (PP-OCR の伝統的な既定)。
  // SDK の既定 (短辺 64 以上・上限 4000) は大きな文字で検出が細切れになる
  // (拡大画像の実測: 1 文字が複数の断片に割れて読み順も壊れた)。
  // 認識段は縮小前の切り抜きを使うので、小さな文字の画質は落ちない
  const bitmap = await toOcrBitmap(blob)
  try {
    const [result] = await service.predict(bitmap, {
      text_det_limit_side_len: 960,
      text_det_limit_type: 'max',
    })
    if (!result) {
      return ''
    }
    // items は検出器の出力順なので、読み順 (縦書きなら右→左) に並べ替えてから
    // 引用ブロックへ整形する。
    return formatOcrQuote(orderOcrItems(result.items))
  } finally {
    bitmap.close()
  }
}
