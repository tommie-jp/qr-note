import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { FIXTURE_EXIF } from '@/test/photoFixtures'
import { minimalExifTiff, readExifFacts, withoutExifHeader } from './tiff'

// sharp が書いた EXIF (TIFF 構造) を取り出す。metadata().exif は "Exif\0\0" 付き
async function sharpExif(exif: object, orientation?: number): Promise<Uint8Array> {
  let image = sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
    .withExif(exif as never)
  if (orientation !== undefined) {
    image = image.withMetadata({ orientation })
  }
  const jpeg = await image.jpeg().toBuffer()
  const meta = await sharp(jpeg).metadata()
  return withoutExifHeader(new Uint8Array(meta.exif ?? []))
}

describe('readExifFacts', () => {
  test('向き・位置・日時・機種を読み分ける', async () => {
    // Arrange
    const tiff = await sharpExif(FIXTURE_EXIF, 6)

    // Act
    const facts = readExifFacts(tiff)

    // Assert
    expect(facts).toEqual({
      orientation: 6,
      gps: true,
      datetime: true,
      camera: true,
      onlyOrientation: false,
    })
  })

  test('位置の IFD があっても緯度経度が無ければ位置ありとは言わない', async () => {
    const tiff = await sharpExif({ IFD3: { GPSVersionID: '2 2 0 0' } })

    expect(readExifFacts(tiff).gps).toBe(false)
  })

  test('撮影日時は Exif IFD の DateTimeOriginal だけでも拾う', async () => {
    const tiff = await sharpExif({ IFD2: { DateTimeOriginal: '2026:09:19 10:00:00' } })

    expect(readExifFacts(tiff).datetime).toBe(true)
  })

  test('ビッグエンディアンの TIFF も読める', () => {
    // MM, 42, IFD0 at 8, 1 entry: Orientation SHORT 1 = 3
    const tiff = new Uint8Array([
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01,
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ])

    expect(readExifFacts(tiff)).toEqual({
      orientation: 3,
      gps: false,
      datetime: false,
      camera: false,
      onlyOrientation: true,
    })
  })

  test('壊れた TIFF は投げずに「何も無い」を返す', () => {
    const broken = [
      new Uint8Array([]),
      new Uint8Array([0x49, 0x49, 0x2a]),
      // IFD0 のオフセットが末尾の外
      new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0xff, 0x00, 0x00, 0x00]),
      // 件数だけ大きく、項目の中身が足りない
      new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0xff, 0x7f]),
      // 知らない並び
      new Uint8Array([0x58, 0x58, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    ]

    for (const tiff of broken) {
      expect(readExifFacts(tiff)).toEqual({
        orientation: null,
        gps: false,
        datetime: false,
        camera: false,
        onlyOrientation: false,
      })
    }
  })

  test('範囲外の向きの値は向きとして扱わない', () => {
    expect(readExifFacts(minimalExifTiff(6)).orientation).toBe(6)
    const bad = minimalExifTiff(6).slice()
    bad[18] = 9 // 値の下位バイト (リトルエンディアン)

    expect(readExifFacts(bad).orientation).toBeNull()
  })
})

describe('minimalExifTiff', () => {
  test('向きだけを持つ最小の TIFF を組む', () => {
    const tiff = minimalExifTiff(8)

    expect(tiff.byteLength).toBe(26)
    expect(readExifFacts(tiff)).toEqual({
      orientation: 8,
      gps: false,
      datetime: false,
      camera: false,
      onlyOrientation: true,
    })
  })

  test('sharp が向きとして読める', async () => {
    // JPEG の APP1 に入れて確かめる (sharp は EXIF 単体を読まない)
    const tiff = minimalExifTiff(6)
    const exif = new Uint8Array([...Buffer.from('Exif\0\0', 'latin1'), ...tiff])
    const plain = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer()
    const app1 = new Uint8Array([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif])
    const jpeg = new Uint8Array([...plain.subarray(0, 2), ...app1, ...plain.subarray(2)])

    expect((await sharp(jpeg).metadata()).orientation).toBe(6)
  })
})

describe('withoutExifHeader', () => {
  test('"Exif\\0\\0" が付いていれば外し、無ければそのまま返す', () => {
    const tiff = minimalExifTiff(6)
    const withHeader = new Uint8Array([...Buffer.from('Exif\0\0', 'latin1'), ...tiff])

    expect(withoutExifHeader(withHeader)).toEqual(tiff)
    expect(withoutExifHeader(tiff)).toBe(tiff)
  })
})
