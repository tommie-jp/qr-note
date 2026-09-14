// アップロード / OCR の進捗表示に使う日本語ボタンラベルの整形。
// 表示文字列そのものを単体テストできるようにここへ分離する。
//
// **% は React state で描くボタン・バナーにだけ出す。本文 (markdown) の
// プレースホルダは静的なままにする** — % で毎回書き換えると、履歴に積まない
// 変更が undo の逆変換位置をずらし、undo し切っても壊れたトークンが本文に
// 残る (E2E で実際に発生した)。
//
// OCR 側に % が無いのは、認識中はメインスレッドが塞がって再描画自体が
// 走らないため (ocrService.ts の ocrImageToQuote 冒頭を参照)。件数だけ出す。

// 進行中アップロードの表示用スナップショット (current は 1 始まり)。
// percent が null なのは送信量を測れない環境 (lengthComputable = false)
export interface UploadProgress {
  current: number
  total: number
  percent: number | null
}

export function uploadButtonLabel(progress: UploadProgress | null): string {
  if (progress === null) {
    return '画像を挿入'
  }
  const { current, total, percent } = progress
  const suffix = percent === null ? '' : ` ${percent}%`
  if (total > 1) {
    return `アップロード中 ${current}/${total}枚${suffix}`
  }
  return `アップロード中…${suffix}`
}

export function ocrButtonLabel(taskCount: number): string {
  if (taskCount === 0) {
    return '画像をOCR'
  }
  return taskCount > 1 ? `OCR処理中 (${taskCount}件)…` : 'OCR処理中…'
}

// 録音の経過時間 (m:ss)。時間単位は出さない — 15 分で自動停止するため
// (audioRecorder.ts の MAX_RECORDING_MS)
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// 録音ボタン。録音中は経過時間を出す (押せば止まると判るよう「停止」を先に置く)
export function recordButtonLabel(isRecording: boolean, elapsedMs: number): string {
  return isRecording ? `停止 ${formatElapsed(elapsedMs)}` : '録音'
}

// 録画は全画面モーダル (VideoRecordModal) で行うので、ツールバーのボタンは
// 「録画」固定。経過時間はモーダル上部で formatElapsed を直接使う。
