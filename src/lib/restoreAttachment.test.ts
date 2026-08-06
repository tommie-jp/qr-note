import { beforeEach, expect, test, vi } from 'vitest'

// DB (imageStore) は差し替える。見たいのは restoreAttachment の判定 —
// 形式の裏付けと大きさの線引きであって、行の作成ではない
const restoreAttachmentRow = vi.fn()

vi.mock('./imageStore', () => ({
  restoreAttachmentRow: (name: string, bytes: Uint8Array, mime: string) =>
    restoreAttachmentRow(name, bytes, mime),
  saveImage: vi.fn(),
  savePlainAttachment: vi.fn(),
}))

const { restoreAttachment } = await import('./attachmentStore')
const { MAX_ZIP_FILE_BYTES } = await import('./zip/limits')

const UUID = '0189d1f0-1b2c-4d5e-8f90-a1b2c3d4e5f6'

// JPEG の先頭バイト (FF D8 FF) を持つ指定サイズのバイト列
function fakeJpeg(bytes: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(bytes)
  data.set([0xff, 0xd8, 0xff, 0xe0])
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  restoreAttachmentRow.mockResolvedValue(true)
})

// CLI 取り込みで入った iPhone 写真 (11〜12MB) が復元で弾かれた退行。
// 上限は Web アップロードの 10MB ではなく「DB に入りうる最大」(50MB) で見る
test('10MB を超える画像も復元できる (CLI 取り込み由来の写真)', async () => {
  const result = await restoreAttachment(`${UUID}.jpg`, fakeJpeg(12 * 1024 * 1024))
  expect(result).toEqual({ ok: true, created: true })
})

test('DB に入りえない大きさ (50MB 超) は理由付きで断る', async () => {
  const result = await restoreAttachment(`${UUID}.jpg`, fakeJpeg(MAX_ZIP_FILE_BYTES + 1))
  expect(result.ok).toBe(false)
  expect(restoreAttachmentRow).not.toHaveBeenCalled()
})

// 「.png という名前の HTML」を保存して配信させない (mime は DB の値が
// そのまま Content-Type になる)
test('拡張子と中身が食い違う添付は断る', async () => {
  const html = new TextEncoder().encode('<html></html>') as Uint8Array<ArrayBuffer>
  const result = await restoreAttachment(`${UUID}.png`, html)
  expect(result.ok).toBe(false)
  expect(restoreAttachmentRow).not.toHaveBeenCalled()
})
