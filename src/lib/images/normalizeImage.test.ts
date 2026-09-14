import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { normalizeImage } from './normalizeImage'

// テスト用フィクスチャはコミットせず sharp でその場で作る (HEIC を除く)。
// 依存を増やさず、環境の sharp が読める形式であることも同時に確かめられる。
async function makeImage(
  format: 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'tiff',
): Promise<Uint8Array<ArrayBuffer>> {
  const base = sharp({
    create: { width: 24, height: 16, channels: 3, background: '#3366cc' },
  })
  const buf = await base[format]().toBuffer()
  return new Uint8Array(buf)
}

describe('normalizeImage', () => {
  test('ブラウザ表示できる形式 (png/jpg/gif/webp/avif) はそのまま返す', async () => {
    const cases: Array<['png' | 'jpg' | 'gif' | 'webp' | 'avif', 'png' | 'jpeg' | 'gif' | 'webp' | 'avif', string]> = [
      ['png', 'png', 'image/png'],
      ['jpg', 'jpeg', 'image/jpeg'],
      ['gif', 'gif', 'image/gif'],
      ['webp', 'webp', 'image/webp'],
      ['avif', 'avif', 'image/avif'],
    ]
    for (const [format, sharpFormat, mime] of cases) {
      const bytes = await makeImage(sharpFormat)
      const result = await normalizeImage(bytes, format)
      // 無変換: バイト列は同一参照、mime/ext は形式に対応
      expect(result.bytes).toBe(bytes)
      expect(result.mime).toBe(mime)
      expect(result.ext).toBe(format)
    }
  })

  test('TIFF は WebP へ変換して返す (ブラウザが表示できないため)', async () => {
    const tiff = await makeImage('tiff')
    const result = await normalizeImage(tiff, 'tiff')

    expect(result.mime).toBe('image/webp')
    expect(result.ext).toBe('webp')
    // 実際に WebP として読み戻せる & 寸法が保たれている
    const meta = await sharp(result.bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(24)
    expect(meta.height).toBe(16)
  })

  test('壊れた入力は例外を投げる (黙って保存しない)', async () => {
    const garbage = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00])
    await expect(normalizeImage(garbage, 'tiff')).rejects.toThrow()
  })
})

// HEIC はフィクスチャを生成できない (sharp が HEVC を書けない) ため、
// リポジトリに小さな .heic を 1 点だけ置いて読む。無ければ skip する
// (フィクスチャ未配置の環境で CI を落とさない)。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HEIC_FIXTURE = join(__dirname, '..', '__fixtures__', 'sample.heic')

describe.skipIf(!existsSync(HEIC_FIXTURE))('normalizeImage (HEIC)', () => {
  test('HEIC は WebP へ変換して返す', async () => {
    const heic = new Uint8Array(readFileSync(HEIC_FIXTURE))
    const result = await normalizeImage(heic, 'heic')

    expect(result.mime).toBe('image/webp')
    expect(result.ext).toBe('webp')
    const meta = await sharp(result.bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBeGreaterThan(0)
    expect(meta.height).toBeGreaterThan(0)
  })
})
