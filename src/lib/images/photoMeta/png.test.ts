import { crc32 } from 'node:zlib'
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
import { stripPng } from './png'
import { PhotoMetaFormatError } from './types'

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeAndData = concat([ascii(type), data])
  const crc = crc32(typeAndData)
  const length = data.byteLength
  return concat([
    [length >>> 24, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff],
    typeAndData,
    [crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff],
  ])
}

// IHDR (先頭 8 + 25 バイト) の直後に差し込む
function insertAfterIhdr(png: Uint8Array, ...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  return concat([png.subarray(0, 33), ...chunks, png.subarray(33)])
}

function chunkTypes(png: Uint8Array): string[] {
  const types: string[] = []
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  for (let at = 8; at + 8 <= png.byteLength; ) {
    const length = view.getUint32(at)
    types.push(Buffer.from(png.subarray(at + 4, at + 8)).toString('latin1'))
    at += 12 + length
  }
  return types
}

describe('stripPng', () => {
  test('eXIf を落とし、向きと色 (iCCP) は残す', async () => {
    // Arrange
    const input = await makePhoto('png', { exif: true, orientation: 6, icc: true })
    const inputMeta = await sharp(input).metadata()

    // Act
    const { bytes, removed } = stripPng(input)

    // Assert
    expect(leakedMarkers(input)).not.toEqual([])
    expect(leakedMarkers(bytes)).toEqual([])
    const meta = await sharp(bytes).metadata()
    expect(meta.orientation).toBe(6)
    expect(meta.icc).toEqual(inputMeta.icc)
    expect(removed).toEqual(new Set(['exif', 'gps', 'datetime', 'camera']))
    expect(await rawPixels(bytes)).toEqual(await rawPixels(input))
  })

  test('書き戻す eXIf は IHDR の直後に置く', async () => {
    const input = await makePhoto('png', { exif: true, orientation: 6 })

    const types = chunkTypes(stripPng(input).bytes)

    expect(types.slice(0, 2)).toEqual(['IHDR', 'eXIf'])
    expect(types.filter((type) => type === 'eXIf')).toHaveLength(1)
  })

  // Apple の書き出す PNG は IDAT の直前に iDOT を置き、IDAT の位置を iDOT の先頭からの
  // 距離で持つ。iDOT と IDAT の間で区画を足し引きすると、その距離がずれて Apple の
  // 復号器が絵を崩す
  describe('iDOT (Apple の分割復号の目印)', () => {
    const iDOT = chunk('iDOT', new Uint8Array(28).fill(7))

    function insertBeforeIdat(png: Uint8Array, ...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
      const at = Buffer.from(png).indexOf(Buffer.from('IDAT', 'latin1')) - 4
      return concat([png.subarray(0, at), ...chunks, png.subarray(at)])
    }

    test('向きを書き戻しても iDOT と IDAT の間には何も挟まない', async () => {
      const input = insertBeforeIdat(await makePhoto('png', { exif: true, orientation: 6 }), iDOT)

      const types = chunkTypes(stripPng(input).bytes)

      expect(types[types.indexOf('IDAT') - 1]).toBe('iDOT')
    })

    test('iDOT と IDAT の間の区画を落とすなら iDOT も落とす', async () => {
      const input = insertBeforeIdat(
        await makePhoto('png'),
        iDOT,
        chunk('tEXt', ascii('Author\0SECRET-OWNER')),
      )

      const { bytes, removed } = stripPng(input)

      expect(chunkTypes(bytes)).not.toContain('iDOT')
      expect(removed).toEqual(new Set(['comment', 'other']))
      expect(await rawPixels(bytes)).toEqual(await rawPixels(input))
    })

    test('iDOT より前の区画を落とすだけなら iDOT は残す', async () => {
      const plain = await makePhoto('png')
      const input = insertBeforeIdat(
        insertAfterIhdr(plain, chunk('tEXt', ascii('Author\0SECRET-OWNER'))),
        iDOT,
      )

      expect(chunkTypes(stripPng(input).bytes)).toContain('iDOT')
    })
  })

  test('向きが無い・正位置なら eXIf を書かない', async () => {
    for (const orientation of [undefined, 1]) {
      const input = await makePhoto('png', { exif: true, orientation })

      expect(chunkTypes(stripPng(input).bytes)).not.toContain('eXIf')
    }
  })

  test('文字の区画・XMP・時刻・署名を落とし、それ以外は残す', async () => {
    // Arrange
    const plain = await makePhoto('png')
    const input = insertAfterIhdr(
      plain,
      chunk('tEXt', ascii('Author\0SECRET-OWNER')),
      chunk('zTXt', ascii('Raw profile type exif\0\0SECRET-OWNER')),
      chunk('iTXt', ascii('XML:com.adobe.xmp\0\0\0\0\0SECRET-OWNER')),
      chunk('tIME', new Uint8Array([0x07, 0xea, 9, 19, 10, 0, 0])),
      chunk('dSIG', ascii('SECRET-OWNER')),
      chunk('gAMA', new Uint8Array([0, 0, 0xb1, 0x8f])),
    )

    // Act
    const { bytes, removed } = stripPng(input)

    // Assert
    expect(containsAscii(bytes, 'SECRET-OWNER')).toBe(false)
    expect(chunkTypes(bytes)).toContain('gAMA')
    expect(removed).toEqual(new Set(['comment', 'exif', 'xmp', 'other']))
    expect(await rawPixels(bytes)).toEqual(await rawPixels(plain))
  })

  test('IEND より後ろの付け足しを落とす', async () => {
    const plain = await makePhoto('png')
    const input = concat([plain, ascii('SECRET-OWNER')])

    const { bytes, removed } = stripPng(input)

    expect(bytes).toEqual(plain)
    expect(removed).toEqual(new Set(['trailer']))
  })

  test('撮影情報が無ければ入力をそのまま返す', async () => {
    const input = await makePhoto('png', { icc: true })

    const result = stripPng(input)

    expect(result.bytes).toBe(input)
    expect(result.removed.size).toBe(0)
  })

  test('2 回掛けても同じ (冪等)', async () => {
    const input = await makePhoto('png', { exif: true, orientation: 5 })

    const once = stripPng(input)
    const twice = stripPng(once.bytes)

    expect(twice.bytes).toBe(once.bytes)
  })

  test('壊れた並びは PhotoMetaFormatError', async () => {
    const plain = await makePhoto('png')
    const cases = [
      // 署名が違う
      concat([[0x89, 0x50, 0x4e, 0x46], plain.subarray(4)]),
      // 区画の長さが末尾の外
      concat([plain.subarray(0, 33), [0x7f, 0xff, 0xff, 0xff], ascii('tEXt')]),
      // IEND に届かない
      plain.subarray(0, plain.byteLength - 12),
    ]

    for (const input of cases) {
      expect(() => stripPng(new Uint8Array(input))).toThrow(PhotoMetaFormatError)
    }
  })
})
