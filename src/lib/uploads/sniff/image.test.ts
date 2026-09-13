import { expect, test } from 'vitest'
import { ftypBox, JPEG_HEAD, PNG_HEAD } from './__fixtures__/media'
import { sniffImageFormat } from './image'

const GIF_HEAD = new TextEncoder().encode('GIF89a')
const WEBP_HEAD = new TextEncoder().encode('RIFF\0\0\0\0WEBP')

test('先頭バイトから画像形式を判定する (sniff)', () => {
  expect(sniffImageFormat(PNG_HEAD)).toBe('png')
  expect(sniffImageFormat(JPEG_HEAD)).toBe('jpg')
  expect(sniffImageFormat(GIF_HEAD)).toBe('gif')
  expect(sniffImageFormat(WEBP_HEAD)).toBe('webp')
})

test('TIFF は big/little endian の両署名を判定する', () => {
  expect(sniffImageFormat(new TextEncoder().encode('II*\0'))).toBe('tiff') // little
  expect(sniffImageFormat(Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a]))).toBe('tiff') // big
})

test('HEIC は ftyp のブランドで判定する', () => {
  expect(sniffImageFormat(ftypBox('heic', ['heic', 'mif1']))).toBe('heic')
  expect(sniffImageFormat(ftypBox('heix', ['heix', 'mif1']))).toBe('heic')
  // iPhone / Nokia サンプルは major=mif1、compatible に heic が入る形
  expect(sniffImageFormat(ftypBox('mif1', ['mif1', 'heic']))).toBe('heic')
})

test('AVIF は ftyp のブランドで判定する (mif1 兼用でも avif を優先)', () => {
  expect(sniffImageFormat(ftypBox('avif', ['avif', 'mif1']))).toBe('avif')
  expect(sniffImageFormat(ftypBox('avis', ['avis', 'avif']))).toBe('avif')
  // major=mif1 でも compatible に avif があれば AVIF (heic より優先して判定)
  expect(sniffImageFormat(ftypBox('mif1', ['mif1', 'avif']))).toBe('avif')
})

test('画像でない・未対応の中身は null (形式判定)', () => {
  const html = new TextEncoder().encode('<html><script>alert(1)</script>')
  expect(sniffImageFormat(html)).toBeNull()
  expect(sniffImageFormat(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  expect(sniffImageFormat(new Uint8Array(0))).toBeNull()
  // ftyp だが未知ブランド (mp4 動画など) は画像として扱わない
  expect(sniffImageFormat(ftypBox('isom', ['isom', 'mp42']))).toBeNull()
})

test('切り詰めた入力でも throw しない (呼び出し側は try/catch しない)', () => {
  // ftyp を名乗る途中で切れたバイト列で例外を出さないこと。
  // sniffImageFormat は route / coverLookup が素で呼ぶので、throw すると
  // アップロードが 500 になり、書影取得は「throw しない」契約を破る。
  // major brand が揃う 12 バイト未満は null、揃えば形式が返る (どちらも throw しない)
  const ftypPrefix = new TextEncoder().encode('\0\0\0\x18ftypheic')
  for (let len = 0; len <= 16; len++) {
    const slice = ftypPrefix.subarray(0, len)
    expect(() => sniffImageFormat(slice)).not.toThrow()
    if (len < 12) {
      expect(sniffImageFormat(slice)).toBeNull() // major brand まで揃っていない
    }
  }
})

test('画像と音声の判定は互いに混ざらない', () => {
  // 画像判定は音声を拾わない
  expect(sniffImageFormat(new TextEncoder().encode('ID3\x04\x00'))).toBeNull()
  expect(sniffImageFormat(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull()
  expect(sniffImageFormat(ftypBox('M4A ', ['M4A ']))).toBeNull()
})
