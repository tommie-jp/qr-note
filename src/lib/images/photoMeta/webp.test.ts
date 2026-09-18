import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import {
  ascii,
  concat,
  containsAscii,
  leakedMarkers,
  makeAnimation,
  makePhoto,
  rawPixels,
} from '@/test/photoFixtures'
import { stripWebp } from './webp'
import { PhotoMetaFormatError } from './types'

const FLAG_EXIF = 0x08
const FLAG_XMP = 0x04

function chunks(webp: Uint8Array): string[] {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength)
  const out: string[] = []
  for (let at = 12; at + 8 <= webp.byteLength; ) {
    const size = view.getUint32(at + 4, true)
    out.push(Buffer.from(webp.subarray(at, at + 4)).toString('latin1'))
    at += 8 + size + (size & 1)
  }
  return out
}

const riffSize = (webp: Uint8Array) =>
  new DataView(webp.buffer, webp.byteOffset, webp.byteLength).getUint32(4, true)

// VP8X の中身の 1 バイト目 (機能の印)
const vp8xFlags = (webp: Uint8Array) => webp[20]

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const size = data.byteLength
  return concat([
    ascii(fourcc),
    [size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, size >>> 24],
    data,
    size & 1 ? [0] : [],
  ])
}

// 末尾に区画を足し、RIFF の長さと VP8X の印を合わせる
function appendChunk(webp: Uint8Array, chunk: Uint8Array, flag: number): Uint8Array<ArrayBuffer> {
  const out = concat([webp, chunk])
  new DataView(out.buffer).setUint32(4, out.byteLength - 8, true)
  out[20] |= flag
  return out
}

describe('stripWebp', () => {
  test('EXIF を落とし、向きと色 (ICCP) は残す', async () => {
    // Arrange
    const input = await makePhoto('webp', { exif: true, orientation: 6, icc: true })
    const inputMeta = await sharp(input).metadata()

    // Act
    const { bytes, removed } = stripWebp(input)

    // Assert
    expect(leakedMarkers(input)).not.toEqual([])
    expect(leakedMarkers(bytes)).toEqual([])
    const meta = await sharp(bytes).metadata()
    expect(meta.orientation).toBe(6)
    expect(meta.icc).toEqual(inputMeta.icc)
    expect(removed).toEqual(new Set(['exif', 'gps', 'datetime', 'camera']))
    expect(riffSize(bytes)).toBe(bytes.byteLength - 8)
    expect(vp8xFlags(bytes) & FLAG_EXIF).toBe(FLAG_EXIF)
    expect(await rawPixels(bytes)).toEqual(await rawPixels(input))
  })

  test('向きが無い・正位置なら EXIF の区画も印も消す', async () => {
    for (const orientation of [undefined, 1]) {
      const input = await makePhoto('webp', { exif: true, orientation })

      const { bytes } = stripWebp(input)

      expect(chunks(bytes)).not.toContain('EXIF')
      expect(vp8xFlags(bytes) & FLAG_EXIF).toBe(0)
      expect(riffSize(bytes)).toBe(bytes.byteLength - 8)
    }
  })

  test('XMP の区画と印を落とす', async () => {
    const plain = await makePhoto('webp', { icc: true })
    const input = appendChunk(plain, riffChunk('XMP ', ascii('<x>SECRET-OWNER</x>')), FLAG_XMP)

    const { bytes, removed } = stripWebp(input)

    expect(containsAscii(bytes, 'SECRET-OWNER')).toBe(false)
    expect(vp8xFlags(bytes) & FLAG_XMP).toBe(0)
    expect(removed).toEqual(new Set(['xmp']))
    expect(bytes).toEqual(plain)
  })

  test('アニメーションのコマを保つ', async () => {
    const input = await makeAnimation('webp', { exif: true })

    const { bytes } = stripWebp(input)

    expect(leakedMarkers(bytes)).toEqual([])
    expect((await sharp(bytes).metadata()).pages).toBe(2)
    expect(await rawPixels(bytes)).toEqual(await rawPixels(input))
  })

  test('RIFF より後ろの付け足しを落とす', async () => {
    const plain = await makePhoto('webp')
    const input = concat([plain, ascii('SECRET-OWNER')])

    const { bytes, removed } = stripWebp(input)

    expect(bytes).toEqual(plain)
    expect(removed).toEqual(new Set(['trailer']))
  })

  test('撮影情報が無ければ入力をそのまま返す', async () => {
    const input = await makePhoto('webp', { icc: true })

    const result = stripWebp(input)

    expect(result.bytes).toBe(input)
    expect(result.removed.size).toBe(0)
  })

  test('2 回掛けても同じ (冪等)', async () => {
    const input = await makePhoto('webp', { exif: true, orientation: 7, icc: true })

    const once = stripWebp(input)
    const twice = stripWebp(once.bytes)

    expect(twice.bytes).toBe(once.bytes)
  })

  test('壊れた並びは PhotoMetaFormatError', async () => {
    const plain = await makePhoto('webp')
    const cases = [
      // WEBP の印が無い
      concat([plain.subarray(0, 8), ascii('WAVE'), plain.subarray(12)]),
      // 区画の長さが末尾の外
      concat([plain.subarray(0, 12), ascii('VP8 '), [0xff, 0xff, 0xff, 0x7f]]),
      // 画像の区画が無い
      concat([ascii('RIFF'), [4, 0, 0, 0], ascii('WEBP')]),
    ]

    for (const input of cases) {
      expect(() => stripWebp(new Uint8Array(input))).toThrow(PhotoMetaFormatError)
    }
  })
})
