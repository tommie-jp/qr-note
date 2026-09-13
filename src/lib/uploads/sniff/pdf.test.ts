import { expect, test } from 'vitest'
import { PNG_HEAD } from './__fixtures__/media'
import { sniffAudioFormat } from './audio'
import { sniffImageFormat } from './image'
import { sniffPdf } from './pdf'

// --- PDF (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

test('先頭が "%PDF-" なら PDF と判定する', () => {
  expect(sniffPdf(new TextEncoder().encode('%PDF-1.7\n%âãÏÓ'))).toBe(true)
  expect(sniffPdf(new TextEncoder().encode('%PDF-1.4'))).toBe(true)
})

test('PDF でない中身・先頭がずれた PDF は false', () => {
  // 署名は offset 0 固定。前に何か付いたポリグロットは受けない
  expect(sniffPdf(new TextEncoder().encode('\n%PDF-1.7'))).toBe(false)
  expect(sniffPdf(new TextEncoder().encode('%PDX-1.7'))).toBe(false)
  expect(sniffPdf(new TextEncoder().encode('<html>'))).toBe(false)
  expect(sniffPdf(PNG_HEAD)).toBe(false)
  expect(sniffPdf(new Uint8Array(0))).toBe(false)
})

test('PDF は画像・音声の判定に混ざらない', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7')
  expect(sniffImageFormat(pdf)).toBeNull()
  expect(sniffAudioFormat(pdf)).toBeNull()
})
