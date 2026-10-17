import { expect, test } from 'vitest'
import { SAFE_ERROR_MAX_LENGTH, safeErrorText } from './safeErrorText'

test('接続文字列など URL の形は丸ごと伏せる (パスワードを画面とコピーに出さない)', () => {
  // Arrange
  const error = new Error(
    "Can't reach database server at postgresql://qr:s3cret@db:5432/qr?schema=public (P1001)",
  )

  // Act
  const text = safeErrorText(error)

  // Assert
  expect(text).toBe("Can't reach database server at [url] (P1001)")
  expect(text).not.toContain('s3cret')
})

test('改行は 1 行に畳み、長すぎれば切って … を付ける', () => {
  // Arrange
  const error = new Error(`first line\n  second\n${'x'.repeat(300)}`)

  // Act
  const text = safeErrorText(error)

  // Assert
  expect(text).not.toContain('\n')
  expect(text.length).toBe(SAFE_ERROR_MAX_LENGTH + 1)
  expect(text.endsWith('…')).toBe(true)
})

test('Error でないものも errorText の流儀で文字にする', () => {
  expect(safeErrorText('boom')).toBe('boom')
})
