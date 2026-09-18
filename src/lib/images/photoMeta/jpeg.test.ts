import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import {
  ascii,
  concat,
  containsAscii,
  leakedMarkers,
  makePhoto,
  rawPixels,
} from '@/test/photoFixtures'
import { stripJpeg } from './jpeg'
import { PhotoMetaFormatError } from './types'

// 区画 1 つ (FF xx + 長さ + 中身)
function segment(marker: number, payload: ArrayLike<number>): Uint8Array<ArrayBuffer> {
  const length = payload.length + 2
  return concat([[0xff, marker, length >> 8, length & 0xff], payload])
}

// SOI の直後に区画を差し込む
function insertAfterSoi(jpeg: Uint8Array, ...segments: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)])
}

// 区画の並び (識別子付き) を読む。SOS 以降は見ない
function markers(jpeg: Uint8Array): string[] {
  const out: string[] = []
  let at = 2
  while (at + 4 <= jpeg.byteLength && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1]
    if (marker === 0xda) {
      out.push('SOS')
      break
    }
    const length = (jpeg[at + 2] << 8) | jpeg[at + 3]
    const id = Buffer.from(jpeg.subarray(at + 4, at + 4 + 5)).toString('latin1').replace(/\0/g, '')
    out.push(marker >= 0xe0 && marker <= 0xef ? `APP${marker - 0xe0}:${id}` : marker.toString(16))
    at += 2 + length
  }
  return out
}

describe('stripJpeg', () => {
  test('位置・日時・機種・所有者名を落とし、向きと色は残す', async () => {
    // Arrange
    const input = await makePhoto('jpeg', { exif: true, orientation: 6, icc: true })
    const inputMeta = await sharp(input).metadata()

    // Act
    const { bytes, removed } = stripJpeg(input)

    // Assert
    expect(leakedMarkers(input)).not.toEqual([])
    expect(leakedMarkers(bytes)).toEqual([])
    const meta = await sharp(bytes).metadata()
    expect(meta.orientation).toBe(6)
    expect(meta.icc).toEqual(inputMeta.icc)
    expect(removed).toEqual(new Set(['exif', 'gps', 'datetime', 'camera']))
  })

  test('画素のバイト列には触らない', async () => {
    const input = await makePhoto('jpeg', { exif: true, orientation: 6, noisy: true, width: 64, height: 48 })

    const { bytes } = stripJpeg(input)

    expect(await rawPixels(bytes)).toEqual(await rawPixels(input))
  })

  test('プログレッシブ JPEG (SOS が複数) も画素を保つ', async () => {
    const input = new Uint8Array(
      await sharp((await makePhoto('png', { noisy: true, width: 64, height: 48 })))
        .withExif({ IFD0: { Make: 'QRNOTE-CAM' } })
        .jpeg({ progressive: true })
        .toBuffer(),
    )

    const { bytes } = stripJpeg(input)

    expect(leakedMarkers(bytes)).toEqual([])
    expect(await rawPixels(bytes)).toEqual(await rawPixels(input))
  })

  test('向きが無い・正位置なら EXIF の区画そのものを書かない', async () => {
    for (const orientation of [undefined, 1]) {
      const input = await makePhoto('jpeg', { exif: true, orientation })

      const { bytes } = stripJpeg(input)

      expect(containsAscii(bytes, 'Exif')).toBe(false)
      expect((await sharp(bytes).metadata()).orientation).toBeUndefined()
    }
  })

  test('撮影情報が無ければ入力をそのまま返す', async () => {
    const input = await makePhoto('jpeg', { icc: true })

    const result = stripJpeg(input)

    expect(result.bytes).toBe(input)
    expect(result.removed.size).toBe(0)
  })

  test('2 回掛けても同じ (冪等)', async () => {
    const input = await makePhoto('jpeg', { exif: true, orientation: 8, icc: true })

    const once = stripJpeg(input)
    const twice = stripJpeg(once.bytes)

    expect(twice.bytes).toBe(once.bytes)
    expect(twice.removed.size).toBe(0)
  })

  test('XMP・IPTC・コメント・MPF・末尾の付け足しを落とし、Adobe の区画は残す', async () => {
    // Arrange
    const plain = await makePhoto('jpeg')
    const xmp = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>SECRET-OWNER</x:xmpmeta>'))
    const iptc = segment(0xed, ascii('Photoshop 3.0\0SECRET-OWNER'))
    const comment = segment(0xfe, ascii('SECRET-OWNER'))
    const mpf = segment(0xe2, ascii('MPF\0SECRET-OWNER'))
    const adobe = segment(0xee, ascii('Adobe\0\x64\0\0\0\0\x01'))
    const trailer = ascii('MotionPhoto_Data SECRET-OWNER')
    const input = concat([insertAfterSoi(plain, xmp, iptc, comment, mpf, adobe), trailer])

    // Act
    const { bytes, removed } = stripJpeg(input)

    // Assert
    expect(containsAscii(bytes, 'SECRET-OWNER')).toBe(false)
    expect(markers(bytes)).toContain('APP14:Adobe')
    expect(removed).toEqual(new Set(['xmp', 'iptc', 'comment', 'other', 'trailer']))
    expect(bytes.subarray(-2)).toEqual(new Uint8Array([0xff, 0xd9]))
    expect(await rawPixels(bytes)).toEqual(await rawPixels(plain))
  })

  test('JFIF の縮小版を空にし、最小 EXIF は JFIF の直後に置く', async () => {
    // Arrange: JFIF 1.01、2x1 のサムネ (RGB 6 バイト)
    const plain = await makePhoto('jpeg', { exif: true, orientation: 3 })
    const jfif = segment(0xe0, [
      ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 2, 1, 9, 9, 9, 9, 9, 9,
    ])
    const input = insertAfterSoi(plain, jfif)

    // Act
    const { bytes, removed } = stripJpeg(input)

    // Assert
    expect(markers(bytes).slice(0, 2)).toEqual(['APP0:JFIF', 'APP1:Exif'])
    const app0Length = (bytes[4] << 8) | bytes[5]
    expect(app0Length).toBe(16)
    expect(bytes[2 + 2 + 14]).toBe(0) // Xthumbnail
    expect(bytes[2 + 2 + 15]).toBe(0) // Ythumbnail
    expect(removed.has('other')).toBe(true)
    expect((await sharp(bytes).metadata()).orientation).toBe(3)
  })

  test('JFXX (サムネ専用の拡張) は落とす', async () => {
    const plain = await makePhoto('jpeg')
    const input = insertAfterSoi(plain, segment(0xe0, ascii('JFXX\0\x10SECRET-OWNER')))

    const { bytes } = stripJpeg(input)

    expect(containsAscii(bytes, 'SECRET-OWNER')).toBe(false)
  })

  test('EOI が無い (途中で切れた) 画像も区画は抜いて返す', async () => {
    const input = await makePhoto('jpeg', { exif: true })
    const truncated = input.subarray(0, input.byteLength - 2)

    const { bytes } = stripJpeg(new Uint8Array(truncated))

    expect(leakedMarkers(bytes)).toEqual([])
  })

  test('壊れた並びは PhotoMetaFormatError', async () => {
    const plain = await makePhoto('jpeg')
    const cases = [
      // SOI が無い
      plain.subarray(2),
      // 区画の長さが 2 未満
      insertAfterSoi(plain, new Uint8Array([0xff, 0xe1, 0x00, 0x01])),
      // 区画の長さが末尾の外
      concat([plain.subarray(0, 2), [0xff, 0xe1, 0xff, 0xff, 0x00]]),
      // 区画の間に FF 以外のゴミ
      concat([plain.subarray(0, 2), [0x00, 0x11], plain.subarray(2)]),
      // SOS に届かない
      concat([plain.subarray(0, 2), segment(0xe1, ascii('Exif\0\0'))]),
    ]

    for (const input of cases) {
      expect(() => stripJpeg(new Uint8Array(input))).toThrow(PhotoMetaFormatError)
    }
  })
})
