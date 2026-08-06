import { strFromU8, strToU8, unzipSync } from 'fflate'
import { expect, test, vi } from 'vitest'
import { createZipStream, type ZipEntry } from './zipStream'

async function* entriesOf(entries: ZipEntry[]): AsyncGenerator<ZipEntry> {
  for (const entry of entries) {
    yield entry
  }
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

test('項目を ZIP として読み戻せる', async () => {
  const zip = await collect(
    createZipStream(
      entriesOf([
        { path: 'notes/1042.md', data: strToU8('本文'), compress: true },
        { path: 'images/a.jpg', data: new Uint8Array([1, 2, 3]), compress: false },
      ]),
    ),
  )

  const files = unzipSync(zip)
  expect(Object.keys(files).sort()).toEqual(['images/a.jpg', 'notes/1042.md'])
  expect(strFromU8(files['notes/1042.md'])).toBe('本文')
  expect([...files['images/a.jpg']]).toEqual([1, 2, 3])
})

// 添付は既に圧縮済み (jpg/webp/mp4) なので素通しで入れる。テキストだけ縮める
test('compress:false の項目は無圧縮で入る', async () => {
  const data = strToU8('あ'.repeat(2000))
  const stored = await collect(
    createZipStream(entriesOf([{ path: 'a.bin', data, compress: false }])),
  )
  const deflated = await collect(
    createZipStream(entriesOf([{ path: 'a.bin', data, compress: true }])),
  )
  expect(stored.length).toBeGreaterThan(deflated.length)
  expect(strFromU8(unzipSync(stored)['a.bin'])).toBe(strFromU8(data))
})

test('項目が 0 件でも壊れていない ZIP になる', async () => {
  const zip = await collect(createZipStream(entriesOf([])))
  expect(unzipSync(zip)).toEqual({})
})

// 1 件が数 MB あるため、読み手が遅いときに全件を先読みしてはいけない
// (本番 VPS は RAM 2GB)。pull されるまで次の項目を取りに行かないこと
test('読み手が引くまで次の項目を取りに行かない', async () => {
  const seen: string[] = []
  async function* watched(): AsyncGenerator<ZipEntry> {
    for (const path of ['a', 'b', 'c']) {
      seen.push(path)
      yield { path, data: new Uint8Array(1024), compress: false }
    }
  }

  const reader = createZipStream(watched()).getReader()
  await reader.read()
  const afterFirstRead = [...seen]
  await reader.cancel()

  expect(afterFirstRead).toEqual(['a'])
})

test('元の並び順のまま入る', async () => {
  const paths = ['notes/1.md', 'notes/2.md', 'notes/10.md']
  const zip = await collect(
    createZipStream(
      entriesOf(paths.map((path) => ({ path, data: strToU8(path), compress: true }))),
    ),
  )
  expect(Object.keys(unzipSync(zip))).toEqual(paths)
})

// 途中で DB が落ちたときなど。壊れた ZIP を「正常な応答」として配らない
test('項目を取り出す途中の失敗はストリームの失敗になる', async () => {
  async function* broken(): AsyncGenerator<ZipEntry> {
    yield { path: 'a', data: new Uint8Array([1]), compress: false }
    throw new Error('DB が落ちました')
  }

  await expect(collect(createZipStream(broken()))).rejects.toThrow('DB が落ちました')
})

// 利用者がダウンロードを中断したとき、DB のカーソルを開いたままにしない
test('読み手が中断したら項目の取り出しも畳む', async () => {
  const cleanup = vi.fn()
  async function* interruptible(): AsyncGenerator<ZipEntry> {
    try {
      for (;;) {
        yield { path: `f${cleanup.mock.calls.length}`, data: new Uint8Array(1), compress: false }
      }
    } finally {
      cleanup()
    }
  }

  const reader = createZipStream(interruptible()).getReader()
  await reader.read()
  await reader.cancel()

  expect(cleanup).toHaveBeenCalled()
})
