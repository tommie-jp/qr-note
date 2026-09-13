// 編集画面の「処理中」の判定と、そのときフォーム送信を止める理由
// (docs/93-リファクタリング計画.md §5-1)。
//
// アップロード / OCR / 録音・録画 / 編集中スキャン / クリップボード取り込みの
// 完了前に送信すると、画像リンクや OCR 結果、録音・録画そのものが memo に
// 入らないため、処理中だけフォーム送信をブロックして知らせる

export interface EditorBusyState {
  // 録音か録画のどちらかが回っている
  isRecording: boolean
  uploading: boolean
  scanBusy: boolean
  clipboardBusy: boolean
  // 実行中の OCR が 1 本以上ある
  ocrRunning: boolean
}

export function isEditorBusy(state: EditorBusyState): boolean {
  return (
    state.uploading ||
    state.ocrRunning ||
    state.isRecording ||
    state.scanBusy ||
    state.clipboardBusy
  )
}

// 処理中にフォーム送信を止めたときに出す理由。**録音を先に見る** —
// アップロードや OCR は画面に進捗が出ているが、録音は押しっぱなしのまま
// 更新しようとすることがあり、そのまま通すと録音ごと失うため。
// どれでもなければ残りは OCR (isEditorBusy が真のときだけ呼ばれる)
export function busyReason(
  state: Omit<EditorBusyState, 'ocrRunning'>,
): string {
  if (state.isRecording) {
    return '録音・録画中です。停止してから更新して下さい。'
  }
  if (state.uploading) {
    return '画像のアップロード中です。完了してから更新して下さい。'
  }
  if (state.scanBusy) {
    return 'コード情報の取得中です。完了してから更新して下さい。'
  }
  if (state.clipboardBusy) {
    return 'クリップボードから取り込み中です。完了してから更新して下さい。'
  }
  return 'OCR 処理中です。完了してから更新して下さい。'
}
