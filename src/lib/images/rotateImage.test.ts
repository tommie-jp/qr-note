import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import {
  isRotatableExt,
  isRotateAngle,
  rotateImageBytes,
} from './rotateImage'

// 元画像: 幅 40 x 高さ 20 の横長。90° 回すと 20 x 40 の縦長になる。
// 左半分を赤・右半分を青にして、回転で色の位置が入れ替わることも確かめる。
async function makeLandscape(
  format: 'png' | 'jpeg' | 'webp' | 'avif',
): Promise<Uint8Array<ArrayBuffer>> {
  const width = 40
  const height = 20
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      if (x < width / 2) {
        pixels[i] = 255 // 左半分 赤
      } else {
        pixels[i + 2] = 255 // 右半分 青
      }
    }
  }
  const buf = await sharp(pixels, { raw: { width, height, channels: 3 } })
    [format]()
    .toBuffer()
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as Uint8Array<ArrayBuffer>
}

describe('isRotateAngle', () => {
  test('90 / 180 / 270 のみ通す', () => {
    expect(isRotateAngle(90)).toBe(true)
    expect(isRotateAngle(180)).toBe(true)
    expect(isRotateAngle(270)).toBe(true)
  })

  test('0 や 45 や 360 や文字列は弾く', () => {
    expect(isRotateAngle(0)).toBe(false)
    expect(isRotateAngle(45)).toBe(false)
    expect(isRotateAngle(360)).toBe(false)
    expect(isRotateAngle('90')).toBe(false)
    expect(isRotateAngle(null)).toBe(false)
  })
})

describe('isRotatableExt', () => {
  test('png/jpg/webp/avif は回せる', () => {
    for (const ext of ['png', 'jpg', 'webp', 'avif']) {
      expect(isRotatableExt(ext)).toBe(true)
    }
  })

  test('gif は回せない (アニメ保持できないため対象外)', () => {
    expect(isRotatableExt('gif')).toBe(false)
    expect(isRotatableExt('mp4')).toBe(false)
  })
})

describe('rotateImageBytes', () => {
  test('90° 回すと幅と高さが入れ替わる (40x20 → 20x40)', async () => {
    const src = await makeLandscape('png')
    const rotated = await rotateImageBytes(src, 'png', 90)
    const meta = await sharp(rotated).metadata()
    expect(meta.width).toBe(20)
    expect(meta.height).toBe(40)
  })

  test('180° は縦横そのまま', async () => {
    const src = await makeLandscape('png')
    const rotated = await rotateImageBytes(src, 'png', 180)
    const meta = await sharp(rotated).metadata()
    expect(meta.width).toBe(40)
    expect(meta.height).toBe(20)
  })

  test('形式は保たれる (webp → webp)', async () => {
    const src = await makeLandscape('webp')
    const rotated = await rotateImageBytes(src, 'webp', 90)
    const meta = await sharp(rotated).metadata()
    expect(meta.format).toBe('webp')
  })

  test('90° 時計回りで左の赤が上へ来る', async () => {
    const src = await makeLandscape('png')
    const rotated = await rotateImageBytes(src, 'png', 90)
    // 時計回り 90°: 元の左端 (赤) が上端へ、右端 (青) が下端へ移る。
    const { data, info } = await sharp(rotated)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const topPixel = (x: number) => {
      const i = x * info.channels
      return { r: data[i], b: data[i + 2] }
    }
    // 上端は赤が強い
    expect(topPixel(5).r).toBeGreaterThan(topPixel(5).b)
  })

  test('EXIF orientation=6 (横倒し) の JPEG を二重回転しない', async () => {
    // orientation=6 は「表示時に時計回り 90° せよ」の意。ブラウザは 40x20 の
    // 画素を 20x40 として見せている。autoOrient せずに rotate(90) だけすると
    // 画素基準で回り、保存後にブラウザが再び EXIF で起こして二重に倒れる。
    // autoOrient を効かせれば、EXIF を焼いた 20x40 を基準に 90° 回って 40x20 になる。
    const withExif = await sharp(await makeLandscape('jpeg'))
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const src = new Uint8Array(
      withExif.buffer,
      withExif.byteOffset,
      withExif.byteLength,
    ) as Uint8Array<ArrayBuffer>
    const rotated = await rotateImageBytes(src, 'jpg', 90)
    const meta = await sharp(rotated).metadata()
    // autoOrient 済みなら表示上の向き (20x40) を 90° 回して 40x20。
    expect(meta.width).toBe(40)
    expect(meta.height).toBe(20)
    // 出力に orientation は残さない (メタデータを落とすので二重回転しない)
    expect(meta.orientation ?? 1).toBe(1)
  })
})
