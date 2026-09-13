import { describe, expect, test } from 'vitest'
import { busyReason, isEditorBusy, type EditorBusyState } from './busyReason'

// busyReason が見る 4 つ (OCR は「どれでもない」ときの残り)
const QUIET = {
  isRecording: false,
  uploading: false,
  scanBusy: false,
  clipboardBusy: false,
}

const IDLE: EditorBusyState = { ...QUIET, ocrRunning: false }

describe('isEditorBusy', () => {
  test('何も走っていなければ false', () => {
    expect(isEditorBusy(IDLE)).toBe(false)
  })

  test('どれか 1 つでも走っていれば true', () => {
    for (const key of Object.keys(IDLE) as (keyof EditorBusyState)[]) {
      expect(isEditorBusy({ ...IDLE, [key]: true })).toBe(true)
    }
  })
})

describe('busyReason', () => {
  // 録音は押しっぱなしのまま更新しようとすることがあり、通すと録音ごと失う
  test('録音・録画をいちばん先に知らせる', () => {
    // Arrange
    const state = { ...QUIET, isRecording: true, uploading: true, scanBusy: true }

    // Act / Assert
    expect(busyReason(state)).toBe('録音・録画中です。停止してから更新して下さい。')
  })

  test('アップロード → スキャン → クリップボードの順に見る', () => {
    expect(busyReason({ ...QUIET, uploading: true, scanBusy: true })).toBe(
      '画像のアップロード中です。完了してから更新して下さい。',
    )
    expect(busyReason({ ...QUIET, scanBusy: true, clipboardBusy: true })).toBe(
      'コード情報の取得中です。完了してから更新して下さい。',
    )
    expect(busyReason({ ...QUIET, clipboardBusy: true })).toBe(
      'クリップボードから取り込み中です。完了してから更新して下さい。',
    )
  })

  test('どれでもなければ OCR', () => {
    expect(busyReason(QUIET)).toBe(
      'OCR 処理中です。完了してから更新して下さい。',
    )
  })
})
