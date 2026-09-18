import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { ascii, concat, containsAscii, FIXTURE_EXIF, leakedMarkers, rawPixels } from '@/test/photoFixtures'
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

// 位置表 (iloc) の値の長さはすべて 0 にできる。そのとき 1 区間あたり 1 バイトも
// 読まずに回るので、数 KB のファイルで件数 × 区間数 (最大 65535) の周回を強いられる
// (レビューで 6KB・1.3 秒・92MB を確認)。周回の総数で早めに断る
describe('細工した位置表', () => {
  function box(type: string, ...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
    const out = concat([new Uint8Array(4), ascii(type), ...parts])
    new DataView(out.buffer).setUint32(0, out.byteLength)
    return out
  }

  function hostileAvif(itemCount: number, extentCount: number): Uint8Array<ArrayBuffer> {
    const infe = box('infe', [2, 0, 0, 0], [0, 1], [0, 0], ascii('Exif'), [0])
    const iinf = box('iinf', [0, 0, 0, 0], [0, 1], infe)
    const items: number[] = []
    for (let i = 0; i < itemCount; i++) {
      // 番号 (2) + 構築方法 (2) + データ参照 (2) + 区間数 (2)。長さの欄は全部 0 バイト
      items.push((i >> 8) & 0xff, i & 0xff, 0, 0, 0, 0, extentCount >> 8, extentCount & 0xff)
    }
    const iloc = box('iloc', [1, 0, 0, 0], [0x00, 0x00], [itemCount >> 8, itemCount & 0xff], items)
    return concat([box('ftyp', ascii('avif'), [0, 0, 0, 0], ascii('avif')), box('meta', [0, 0, 0, 0], iinf, iloc)])
  }

  test('値の長さが 0 の区間を大量に並べた位置表は、回りきる前に断る', () => {
    const input = hostileAvif(1000, 65535)

    const started = performance.now()
    expect(() => stripAvif(input)).toThrow(PhotoMetaFormatError)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
