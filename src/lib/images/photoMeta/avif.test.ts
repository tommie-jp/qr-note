import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { concat, containsAscii, FIXTURE_EXIF, leakedMarkers, rawPixels } from '@/test/photoFixtures'
import { stripAvif } from './avif'
import { PhotoMetaFormatError } from './types'

const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/">SECRET-OWNER</x:xmpmeta>'

async function makeAvif(options: { exif?: boolean; xmp?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  let image = sharp({ create: { width: 16, height: 8, channels: 3, background: '#3366cc' } })
  if (options.exif) {
    image = image.withExif(FIXTURE_EXIF)
  }
  if (options.xmp) {
    image = image.withXmp(XMP)
  }
  return new Uint8Array(await image.avif().toBuffer())
}

describe('stripAvif', () => {
  test('Exif と XMP のアイテムを 0 で埋め、箱の並びと画素は変えない', async () => {
    // Arrange
    const input = await makeAvif({ exif: true, xmp: true })

    // Act
    const { bytes, removed } = stripAvif(input)

    // Assert
    expect(leakedMarkers(input)).not.toEqual([])
    expect(leakedMarkers(bytes)).toEqual([])
    expect(containsAscii(bytes, 'SECRET-OWNER')).toBe(false)
    expect(bytes.byteLength).toBe(input.byteLength)
    expect(removed).toEqual(new Set(['exif', 'gps', 'datetime', 'camera', 'xmp']))
    expect(await rawPixels(bytes)).toEqual(await rawPixels(input))
  })

  test('撮影情報が無ければ入力をそのまま返す', async () => {
    const input = await makeAvif()

    const result = stripAvif(input)

    expect(result.bytes).toBe(input)
    expect(result.removed.size).toBe(0)
  })

  test('2 回掛けても同じ (冪等)', async () => {
    const input = await makeAvif({ exif: true })

    const once = stripAvif(input)
    const twice = stripAvif(once.bytes)

    expect(twice.bytes).toBe(once.bytes)
    expect(twice.removed.size).toBe(0)
  })

  test('壊れた箱は PhotoMetaFormatError', async () => {
    const input = await makeAvif({ exif: true })
    const metaAt = 28 // ftyp (28 バイト) の直後
    const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    // meta の長さが末尾の外
    const longMeta = input.slice()
    view(longMeta).setUint32(metaAt, 0x7fffffff)
    // 途中で切れている (iloc が指す先が無い)
    const truncated = input.slice(0, input.byteLength - 40)

    for (const broken of [longMeta, truncated, concat([input.subarray(0, 40)])]) {
      expect(() => stripAvif(new Uint8Array(broken))).toThrow(PhotoMetaFormatError)
    }
  })
})
