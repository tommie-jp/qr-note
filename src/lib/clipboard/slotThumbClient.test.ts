import { describe, expect, test, vi } from 'vitest'
import { makeClientThumb } from './slotThumbClient'

const file = new File([new Uint8Array([1])], 'a.bin')
const blob = new Blob([new Uint8Array([2])], { type: 'image/jpeg' })

function deps() {
  return {
    videoPoster: vi.fn(async () => blob),
    pdfFirstPage: vi.fn(async () => blob),
  }
}

describe('makeClientThumb (送るファイルから見本の絵を作る)', () => {
  test('動画は先頭コマ', async () => {
    const d = deps()

    expect(await makeClientThumb(file, 'video', d)).toBe(blob)
    expect(d.videoPoster).toHaveBeenCalledWith(file)
    expect(d.pdfFirstPage).not.toHaveBeenCalled()
  })

  test('PDF は 1 ページ目', async () => {
    const d = deps()

    expect(await makeClientThumb(file, 'pdf', d)).toBe(blob)
    expect(d.pdfFirstPage).toHaveBeenCalledWith(file)
  })

  // 画像・テキスト・Office はサーバが作る。それ以外は札で足りる
  test.each(['image', 'textfile', 'audio', 'file', 'text'] as const)('%s はクライアントでは作らない', async (kind) => {
    const d = deps()

    expect(await makeClientThumb(file, kind, d)).toBeNull()
    expect(d.videoPoster).not.toHaveBeenCalled()
    expect(d.pdfFirstPage).not.toHaveBeenCalled()
  })

  // 見本は派生物。描けない動画 (iOS の HEVC を Chrome で) でも送るのは止めない
  test('描けなければ null (投げない)', async () => {
    const d = { videoPoster: vi.fn(async () => Promise.reject(new Error('decode'))), pdfFirstPage: vi.fn() }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await makeClientThumb(file, 'video', d)).toBeNull()
    spy.mockRestore()
  })
})
