import { describe, expect, test } from 'vitest'
import {
  formatElapsed,
  ocrButtonLabel,
  recordButtonLabel,
  uploadButtonLabel,
} from './progressLabels'

describe('uploadButtonLabel', () => {
  test('shows the idle label when no upload is running', () => {
    expect(uploadButtonLabel(null)).toBe('画像を挿入')
  })

  test('shows percent only for a single file', () => {
    expect(uploadButtonLabel({ current: 1, total: 1, percent: 45 })).toBe(
      'アップロード中… 45%',
    )
  })

  test('shows m/n枚 and percent for a batch', () => {
    expect(uploadButtonLabel({ current: 2, total: 3, percent: 45 })).toBe(
      'アップロード中 2/3枚 45%',
    )
  })

  // 送信量を測れない環境では 0% 張り付きより % 無しの方がまし
  test('omits percent when it cannot be measured', () => {
    expect(uploadButtonLabel({ current: 1, total: 1, percent: null })).toBe(
      'アップロード中…',
    )
    expect(uploadButtonLabel({ current: 2, total: 3, percent: null })).toBe(
      'アップロード中 2/3枚',
    )
  })
})

describe('ocrButtonLabel', () => {
  test('shows the idle label when no OCR is running', () => {
    expect(ocrButtonLabel(0)).toBe('画像をOCR')
  })

  test('shows a plain busy label for a single task', () => {
    expect(ocrButtonLabel(1)).toBe('OCR処理中…')
  })

  test('shows the task count when tasks run concurrently', () => {
    expect(ocrButtonLabel(2)).toBe('OCR処理中 (2件)…')
  })
})

describe('formatElapsed', () => {
  test('shows m:ss with a zero-padded seconds field', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(9_000)).toBe('0:09')
    expect(formatElapsed(65_000)).toBe('1:05')
  })

  test('keeps counting in minutes past an hour (no hour field)', () => {
    expect(formatElapsed(3_600_000)).toBe('60:00')
  })

  test('never shows a negative time (clock skew)', () => {
    expect(formatElapsed(-1_000)).toBe('0:00')
  })
})

describe('recordButtonLabel', () => {
  test('shows the idle label when not recording', () => {
    expect(recordButtonLabel(false, 0)).toBe('録音')
  })

  test('shows how to stop and how long it has run', () => {
    expect(recordButtonLabel(true, 12_000)).toBe('停止 0:12')
  })
})

