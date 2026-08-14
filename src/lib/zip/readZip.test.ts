import { strToU8, zipSync } from 'fflate'
import { expect, test } from 'vitest'
import { chunkedBytes } from '@/lib/bytes'
import { MAX_ZIP_ENTRIES, MAX_ZIP_FILE_BYTES } from './limits'
import { type RawZipEntry, readZipStream } from './readZip'

// 展開後の合計 (MAX_ZIP_TOTAL_BYTES = 1GB) の門を試すテストは、それだけで
// 1GB を deflate する = 1 本 8〜10 秒かかるため別ファイルに出してある。
// vitest はファイル単位で並列化するので、分けた 2 本は同時に走る
// (docs/80-デプロイ再高速化計画.md §9):
//   - readZip.totalLimit.test.ts          … 読む項目の合計
//   - readZip.totalLimit.skipped.test.ts  … 読まない項目も数えること

// 取り込みは本文を流し読みする。テストからも同じ形 (バイト列の並び) で渡す
async function readAll(zip: Uint8Array): Promise<RawZipEntry[]> {
  const entries: RawZipEntry[] = []
  await readZipStream(chunkedBytes(zip), async (entry) => {
    // 呼び出し側が抱えるなら自分で写す (渡されたバイト列は次へ進むと捨てられる)
    entries.push({ path: entry.path, data: entry.data.slice() })
  })
  return entries
}

// --- 読む項目を呼び出し側が選ぶ (ZipReadOptions.accept) ---

async function readAccepted(
  zip: Uint8Array,
  accept: (path: string) => boolean,
): Promise<RawZipEntry[]> {
  const entries: RawZipEntry[] = []
  await readZipStream(
    chunkedBytes(zip),
    async (entry) => {
      entries.push({ path: entry.path, data: entry.data.slice() })
    },
    { accept },
  )
  return entries
}

test('accept が false を返した項目は渡ってこない', async () => {
  const zip = zipSync({
    'notes/1042.md': strToU8('本文'),
    'app.exe': strToU8('MZ...'),
  })

  const entries = await readAccepted(zip, (path) => path.startsWith('notes/'))

  expect(entries.map((entry) => entry.path)).toEqual(['notes/1042.md'])
})

// 取り込まない項目の大きさは、こちらの器の都合とは関係がない。ここを門に
// 掛けると、関係のない ZIP を選んだだけで「中の exe が大きすぎます」になる
test('読まない項目は 1 項目の大きさの門に掛からない', async () => {
  const zip = zipSync({
    'app.exe': new Uint8Array(MAX_ZIP_FILE_BYTES + 1),
    'notes/1042.md': strToU8('本文'),
  })

  const entries = await readAccepted(zip, (path) => path.startsWith('notes/'))

  expect(entries.map((entry) => entry.path)).toEqual(['notes/1042.md'])
})

test('項目を名前とバイト列で取り出す', async () => {
  const zip = zipSync({
    'notes/1042.md': strToU8('本文'),
    'images/a.jpg': new Uint8Array([1, 2, 3]),
  })

  const entries = await readAll(zip)

  expect(entries.map((entry) => entry.path).sort()).toEqual([
    'images/a.jpg',
    'notes/1042.md',
  ])
  expect(new TextDecoder().decode(entries[0].data)).toBe('本文')
})

// fflate の Unzip は署名の無いデータを黙って読み飛ばす。先頭を見ずに通すと
// 「別のファイルを選んだ」が「0 件取り込めました」になってしまう
test('ZIP でないファイルは理由付きで投げる', async () => {
  await expect(readAll(strToU8('ただのテキスト'))).rejects.toThrow(
    /ZIP ファイルではありません/,
  )
})

test('途中で切れた ZIP は 0 件ではなく理由付きで投げる', async () => {
  const zip = zipSync({ 'notes/1042.md': strToU8('本文') })
  await expect(readAll(zip.slice(0, 8))).rejects.toThrow(/読み取れませんでした/)
})

// ZIP 爆弾。入口が大きくなくても出口は無限になりうる。
// zipSync が書くヘッダは展開後の大きさを名乗るので、**展開する前に**断てる
test('展開後の大きさを名乗っている項目は展開前に断る', async () => {
  const bomb = zipSync({ 'images/a.jpg': new Uint8Array(MAX_ZIP_FILE_BYTES + 1) })
  expect(bomb.length).toBeLessThan(MAX_ZIP_FILE_BYTES)

  await expect(readAll(bomb)).rejects.toThrow(/大きすぎ/)
})

test('項目数が上限を超えたら投げる', async () => {
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index <= MAX_ZIP_ENTRIES; index += 1) {
    files[`notes/${index}.md`] = strToU8('x')
  }

  await expect(readAll(zipSync(files))).rejects.toThrow(/多すぎ/)
}, 60000)

// 上限より 1 つ手前までは通ること。fflate は項目ごとに再帰するので、入力を
// 1 回で push していた頃はここが 3500 件で RangeError になっていた
// (だから細切れに push している)
test('上限ぎりぎりの項目数は通る', async () => {
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index < MAX_ZIP_ENTRIES; index += 1) {
    files[`notes/${index}.md`] = strToU8('x')
  }

  const entries = await readAll(zipSync(files))

  expect(entries).toHaveLength(MAX_ZIP_ENTRIES)
}, 60000)

test('空の ZIP は空の配列', async () => {
  expect(await readAll(zipSync({}))).toEqual([])
})

// ディレクトリ項目は中身を持たない。振り分け (layout.ts) に渡す前に落とす
test('ディレクトリ項目は返さない', async () => {
  const zip = zipSync({ notes: { '1042.md': strToU8('本文') } })
  const entries = await readAll(zip)
  expect(entries.map((entry) => entry.path)).toEqual(['notes/1042.md'])
})

// 500MB を受けるための土台。全部読み終えてから配るのでは意味がない
test('項目は入力を読み切る前に渡ってくる', async () => {
  // **縮まないバイト列**にする。規則のあるデータだと ZIP 全体が 1 チャンクに
  // 収まってしまい、「読み切る前に渡ってくる」ことを確かめられない
  // getRandomValues は 1 回 64KB までしか埋められないので、刻んで埋める
  const random = () => {
    const bytes = new Uint8Array(200 * 1024)
    for (let start = 0; start < bytes.length; start += 65536) {
      crypto.getRandomValues(bytes.subarray(start, start + 65536))
    }
    return bytes
  }
  const zip = zipSync({
    'images/1.jpg': random(),
    'images/2.jpg': random(),
    'images/3.jpg': random(),
  })

  let fedChunks = 0
  let fedWhenFirstHandled: number | null = null
  async function* counted(): AsyncGenerator<Uint8Array> {
    for await (const chunk of chunkedBytes(zip)) {
      fedChunks += 1
      yield chunk
    }
  }

  const seen: string[] = []
  await readZipStream(counted(), async (entry) => {
    seen.push(entry.path)
    fedWhenFirstHandled ??= fedChunks
  })

  expect(seen).toHaveLength(3)
  // 最初の項目を受け取った時点で、入力はまだ全部は流し込まれていない
  expect(fedWhenFirstHandled).not.toBeNull()
  expect(fedWhenFirstHandled).toBeLessThan(fedChunks)
})
