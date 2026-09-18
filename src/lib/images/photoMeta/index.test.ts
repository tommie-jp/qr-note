import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { concat, leakedMarkers, makeAnimation, makePhoto } from '@/test/photoFixtures'
import { analyzePhotoMeta, isPhotoFormat, stripPhotoMeta } from './index'

describe('stripPhotoMeta', () => {
  test('形式ごとの抜き方へ振り分け、撮影情報を残さない', async () => {
    // Arrange
    const inputs = [
      ['jpg', await makePhoto('jpeg', { exif: true, orientation: 6 })],
      ['png', await makePhoto('png', { exif: true, orientation: 6 })],
      ['webp', await makePhoto('webp', { exif: true, orientation: 6 })],
      ['avif', await makePhoto('avif', { exif: true })],
      ['gif', await makeAnimation('gif')],
    ] as const

    for (const [format, input] of inputs) {
      // Act
      const bytes = await stripPhotoMeta(input, format)

      // Assert
      expect(leakedMarkers(bytes), format).toEqual([])
      expect((await sharp(bytes).metadata()).format).toBe(format === 'jpg' ? 'jpeg' : format === 'avif' ? 'heif' : format)
    }
  })

  test('区画を読めない画像は sharp で作り直し、向きは画素へ焼く', async () => {
    // Arrange: 区画の境目にゴミを挟む。libjpeg は読み飛ばして復号できる
    const photo = await makePhoto('jpeg', { exif: true, orientation: 6 })
    const input = concat([photo.subarray(0, 2), [0x00, 0x11], photo.subarray(2)])
    expect(() => analyzePhotoMeta(input, 'jpg')).toThrow()

    // Act
    const bytes = await stripPhotoMeta(input, 'jpg')

    // Assert
    expect(leakedMarkers(bytes)).toEqual([])
    const meta = await sharp(bytes).metadata()
    expect(meta.orientation).toBeUndefined()
    // 24x16 を 90° 起こした寸法になっている
    expect([meta.width, meta.height]).toEqual([16, 24])
  })

  test('作り直しもできない壊れた画像は例外 (黙って保存しない)', async () => {
    const garbage = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x13, 0x37])

    await expect(stripPhotoMeta(garbage, 'jpg')).rejects.toThrow()
  })
})

describe('analyzePhotoMeta', () => {
  test('何を抜いたかを返す (バックフィルの件数に使う)', async () => {
    const input = await makePhoto('jpeg', { exif: true })

    const { removed } = analyzePhotoMeta(input, 'jpg')

    expect(removed).toEqual(new Set(['exif', 'gps', 'datetime', 'camera']))
  })
})

describe('isPhotoFormat', () => {
  test('素通しで保存する 5 形式だけを受ける', () => {
    for (const format of ['jpg', 'png', 'webp', 'gif', 'avif']) {
      expect(isPhotoFormat(format)).toBe(true)
    }
    for (const format of ['jpeg', 'heic', 'tiff', 'pdf', '']) {
      expect(isPhotoFormat(format)).toBe(false)
    }
  })
})
