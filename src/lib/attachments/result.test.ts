import { expect, test } from 'vitest'
import { mismatch, succeed } from './result'

test('succeed は URL の末尾を保存名として返す', () => {
  // Act
  const result = succeed('/api/images/0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6.webp', true)

  // Assert
  expect(result).toEqual({
    ok: true,
    url: '/api/images/0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6.webp',
    name: '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6.webp',
    isImage: true,
  })
})

test('succeed は画像でない添付を isImage: false で返す', () => {
  expect(succeed('/api/images/a.pdf', false)).toEqual({
    ok: true,
    url: '/api/images/a.pdf',
    name: 'a.pdf',
    isImage: false,
  })
})

test('mismatch は名乗った拡張子を理由に入れて断る', () => {
  expect(mismatch('png')).toEqual({
    ok: false,
    reason: '中身が拡張子 (.png) と一致しません',
  })
})
