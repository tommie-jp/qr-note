import { strToU8, zipSync } from 'fflate'
import { expect, test } from 'vitest'
import {
  MAX_ZIP_ENTRIES,
  MAX_ZIP_FILE_BYTES,
  MAX_ZIP_TOTAL_BYTES,
} from './limits'
import { readZipEntries } from './readZip'

test('項目を名前とバイト列で取り出す', () => {
  const zip = zipSync({
    'notes/1042.md': strToU8('本文'),
    'images/a.jpg': new Uint8Array([1, 2, 3]),
  })

  const entries = readZipEntries(zip)

  expect(entries.map((entry) => entry.path).sort()).toEqual([
    'images/a.jpg',
    'notes/1042.md',
  ])
  expect(new TextDecoder().decode(entries[0].data)).toBe('本文')
})

// fflate の Unzip は署名の無いデータを黙って読み飛ばす。先頭を見ずに通すと
// 「別のファイルを選んだ」が「0 件取り込めました」になってしまう
test('ZIP でないファイルは理由付きで投げる', () => {
  expect(() => readZipEntries(strToU8('ただのテキスト'))).toThrow(
    /ZIP ファイルではありません/,
  )
})

test('途中で切れた ZIP は 0 件ではなく理由付きで投げる', () => {
  const zip = zipSync({ 'notes/1042.md': strToU8('本文') })
  expect(() => readZipEntries(zip.slice(0, 8))).toThrow(/読み取れませんでした/)
})

// ZIP 爆弾。入口が 10MB でも出口は無限になりうる。
// zipSync が書くヘッダは展開後の大きさを名乗るので、**展開する前に**断てる
test('展開後の大きさを名乗っている項目は展開前に断る', () => {
  const bomb = zipSync({ 'images/a.jpg': new Uint8Array(MAX_ZIP_FILE_BYTES + 1) })
  expect(bomb.length).toBeLessThan(MAX_ZIP_FILE_BYTES)

  expect(() => readZipEntries(bomb)).toThrow(/大きすぎ/)
})

// 名乗らない ZIP (このアプリの書き出しもデータ記述子を使うので名乗らない) は
// 出てきたバイト数で数えて断つ
test('合計が上限を超えたら投げる', () => {
  const chunk = new Uint8Array(MAX_ZIP_FILE_BYTES - 1)
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index * (MAX_ZIP_FILE_BYTES - 1) <= MAX_ZIP_TOTAL_BYTES; index += 1) {
    files[`images/${index}.jpg`] = chunk
  }

  expect(() => readZipEntries(zipSync(files))).toThrow(/合計が大きすぎ/)
})

test('項目数が上限を超えたら投げる', () => {
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index <= MAX_ZIP_ENTRIES; index += 1) {
    files[`notes/${index}.md`] = strToU8('x')
  }

  expect(() => readZipEntries(zipSync(files))).toThrow(/多すぎ/)
})

test('空の ZIP は空の配列', () => {
  expect(readZipEntries(zipSync({}))).toEqual([])
})

// ディレクトリ項目は中身を持たない。振り分け (layout.ts) に渡す前に落とす
test('ディレクトリ項目は返さない', () => {
  const zip = zipSync({ notes: { '1042.md': strToU8('本文') } })
  const entries = readZipEntries(zip)
  expect(entries.map((entry) => entry.path)).toEqual(['notes/1042.md'])
})
