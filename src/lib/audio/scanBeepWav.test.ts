import { expect, test } from 'vitest'
import {
  SCAN_BEEP_SAMPLE_COUNT,
  buildScanBeepWavBytes,
  scanBeepDataUri,
} from './scanBeepWav'

const HEADER = 44

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length))

const peak = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer)
  let max = 0
  for (let i = HEADER; i < bytes.length; i += 2) {
    max = Math.max(max, Math.abs(view.getInt16(i, true)))
  }
  return max
}

test('16bit モノラルの WAV ヘッダを持つ', () => {
  const bytes = buildScanBeepWavBytes(1)
  const view = new DataView(bytes.buffer)
  expect(ascii(bytes, 0, 4)).toBe('RIFF')
  expect(ascii(bytes, 8, 4)).toBe('WAVE')
  expect(ascii(bytes, 36, 4)).toBe('data')
  expect(view.getUint16(22, true)).toBe(1) // モノラル
  expect(view.getUint16(34, true)).toBe(16) // 16bit
  expect(view.getUint32(40, true)).toBe(SCAN_BEEP_SAMPLE_COUNT * 2)
  expect(view.getUint32(4, true)).toBe(bytes.length - 8)
})

test('振幅は渡した段どおりになる', () => {
  expect(peak(buildScanBeepWavBytes(1))).toBeGreaterThan(32_000)
  const half = peak(buildScanBeepWavBytes(0.5))
  expect(half).toBeGreaterThan(16_000)
  expect(half).toBeLessThanOrEqual(16_384)
  expect(peak(buildScanBeepWavBytes(0))).toBe(0)
})

test('範囲外の振幅は端へ寄せる', () => {
  expect(peak(buildScanBeepWavBytes(5))).toBe(peak(buildScanBeepWavBytes(1)))
  expect(peak(buildScanBeepWavBytes(-1))).toBe(0)
})

// 頭と尻を 0 から立ち上げないとスピーカーでプチ音になる
test('頭と尻は 0 から立ち上がり 0 へ戻る', () => {
  const bytes = buildScanBeepWavBytes(1)
  const view = new DataView(bytes.buffer)
  expect(view.getInt16(HEADER, true)).toBe(0)
  expect(view.getInt16(bytes.length - 2, true)).toBe(0)
})

test('data URI は同じ段なら同じ文字列を返す', () => {
  const uri = scanBeepDataUri(0.2)
  expect(uri.startsWith('data:audio/wav;base64,UklGR')).toBe(true)
  expect(scanBeepDataUri(0.2)).toBe(uri)
  expect(scanBeepDataUri(1)).not.toBe(uri)
})
