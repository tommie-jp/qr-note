import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { makeSlotPreview } from './slotPreview'

const png = async (width = 800, height = 600) =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).png().toBuffer(),
  )

describe('makeSlotPreview (置くときに作る見本)', () => {
  test('画像は長辺 384 の WebP の絵', async () => {
    const { thumb, preview } = await makeSlotPreview({ mime: 'image/png', data: await png() })

    expect(preview).toBeNull()
    const meta = await sharp(thumb ?? new Uint8Array()).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(384)
  })

  test('壊れた画像は見本なし (投げない)', async () => {
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])

    await expect(makeSlotPreview({ mime: 'image/png', data: broken })).resolves.toEqual({
      thumb: null,
      preview: null,
    })
  })

  test('テキストファイルは先頭の抜粋', async () => {
    const data = new TextEncoder().encode('名前,点\nあ,90\nい,80\nう,70\nえ,60\n')

    const { thumb, preview } = await makeSlotPreview({ mime: 'text/csv; charset=utf-8', data })

    expect(thumb).toBeNull()
    expect(preview).toBe('名前,点\nあ,90\nい,80\nう,70…')
  })

  test('docx は本文の抜粋', async () => {
    const data = zipSync({ 'word/document.xml': strToU8('<w:p><w:t>議事録</w:t></w:p>') })

    const { preview } = await makeSlotPreview({
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data,
    })

    expect(preview).toBe('議事録')
  })

  // 動画と PDF の絵はクライアントが作って後から貼る。サーバは作らない
  test.each(['video/mp4', 'application/pdf', 'audio/mpeg', 'application/octet-stream'])(
    '%s はサーバでは見本を作らない',
    async (mime) => {
      await expect(makeSlotPreview({ mime, data: new Uint8Array([1, 2, 3]) })).resolves.toEqual({
        thumb: null,
        preview: null,
      })
    },
  )
})
