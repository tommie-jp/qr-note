// 撮影情報の削除 (docs/113-写真の撮影情報削除計画.md) のテスト素材。
//
// フィクスチャはコミットせず sharp でその場で作る (images/normalizeImage.test.ts と
// 同じ流儀)。撮影情報には**見つけやすい文字列**を入れておき、出力のバイト列に
// その文字列が 1 か所でも残っていないかで漏れを判定する。GPS は有理数なので
// 文字列にならないが、GPS IFD は EXIF の中にしか置けないので、EXIF が最小形
// (向きだけ) になっていれば一緒に消えている
import sharp from 'sharp'

export const LEAK_MARKERS = ['QRNOTE-CAM', 'SECRET-OWNER', '2026:09:19'] as const

export const FIXTURE_EXIF = {
  IFD0: {
    Make: 'QRNOTE-CAM',
    Model: 'M1',
    Artist: 'SECRET-OWNER',
    DateTime: '2026:09:19 10:00:00',
  },
  IFD2: { DateTimeOriginal: '2026:09:19 10:00:00' },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '35/1 40/1 0/1',
    GPSLongitudeRef: 'E',
    GPSLongitude: '139/1 45/1 0/1',
  },
}

export type FixtureFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif'

interface PhotoOptions {
  // 撮影情報 (上の FIXTURE_EXIF) を入れるか
  exif?: boolean
  // EXIF の向き (1〜8)。入れなければ向きの項目自体が無い
  orientation?: number
  // Display P3 の ICC を入れるか
  icc?: boolean
  // 画素を乱数で埋める (JPEG のエントロピー符号化に 0xFF の詰め物を出すため)
  noisy?: boolean
  width?: number
  height?: number
}

export async function makePhoto(
  format: FixtureFormat,
  options: PhotoOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const width = options.width ?? 24
  const height = options.height ?? 16
  let image = options.noisy
    ? sharp(noise(width, height), { raw: { width, height, channels: 3 } })
    : sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
  if (options.exif) {
    image = image.withExif(FIXTURE_EXIF)
  }
  if (options.orientation !== undefined) {
    image = image.withMetadata({ orientation: options.orientation })
  }
  if (options.icc) {
    image = image.withIccProfile('p3')
  }
  const out = await image.toFormat(format).toBuffer()
  return new Uint8Array(out)
}

// 2 コマのアニメーション (GIF / WebP)
export async function makeAnimation(
  format: 'gif' | 'webp',
  options: { exif?: boolean } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const frame = (color: string) =>
    sharp({ create: { width: 12, height: 8, channels: 3, background: color } })
      .png()
      .toBuffer()
  let image = sharp([await frame('#ff0000'), await frame('#0000ff')], {
    join: { animated: true },
  })
  if (options.exif) {
    image = image.withExif(FIXTURE_EXIF)
  }
  // loop: 0 (無限) にしておく。sharp の既定 (1 回) だと GIF はループ指定の
  // 拡張 (NETSCAPE2.0) を書かず、残すべき区画を確かめられない
  const out = await image.toFormat(format, { loop: 0 }).toBuffer()
  return new Uint8Array(out)
}

function noise(width: number, height: number): Buffer {
  // 乱数ではなく決まった列にする (テストを毎回同じ入力で回す)
  const out = Buffer.alloc(width * height * 3)
  let seed = 12345
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = seed >> 16
  }
  return out
}

export function containsAscii(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(
    Buffer.from(text, 'latin1'),
  )
}

export function leakedMarkers(bytes: Uint8Array): string[] {
  return LEAK_MARKERS.filter((marker) => containsAscii(bytes, marker))
}

// 画素そのもの (sharp の raw)。区画を抜いても画素のバイト列は変わらないことを見る。
// 向きは当てない — EXIF の向きを残す処理なので、画素は入力のまま並んでいるはず
export async function rawPixels(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { animated: true }).raw().toBuffer()
}

// ASCII を 1 バイト 1 文字のまま並べる
export function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, 'latin1'))
}

export function concat(parts: readonly ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
