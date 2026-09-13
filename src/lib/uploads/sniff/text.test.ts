import { expect, test } from 'vitest'
import { textSaveInfo } from './text'

// --- テキスト系 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md) ---

test('元のファイル名から保存する mime / ext を決める (名前は保存名に使わない)', () => {
  expect(textSaveInfo('memo.md')).toEqual({
    mime: 'text/markdown; charset=utf-8',
    ext: 'md',
  })
  expect(textSaveInfo('売上.CSV')).toEqual({
    mime: 'text/csv; charset=utf-8',
    ext: 'csv',
  })
  expect(textSaveInfo('notes.txt')).toEqual({
    mime: 'text/plain; charset=utf-8',
    ext: 'txt',
  })
})

// **知らない拡張子は txt に倒さない。** テキストには署名が無く HTML も SVG も
// 「テキストとしては妥当」なので、名前でも名乗らせないと何でも通ってしまう
// (拡張子・MIME を偽装したものは弾く、という既存方針を保つ)
test('txt/csv/md 以外の名前はテキストとして受けない', () => {
  expect(textSaveInfo('evil.html')).toBeNull()
  expect(textSaveInfo('drawing.svg')).toBeNull()
  expect(textSaveInfo('archive.tar.gz')).toBeNull()
  expect(textSaveInfo('名前に拡張子が無い')).toBeNull()
  // 拡張子は「ドットのある末尾」だけ。名前そのものが csv でも拡張子ではない
  expect(textSaveInfo('csv')).toBeNull()
  expect(textSaveInfo(null)).toBeNull()
  expect(textSaveInfo(undefined)).toBeNull()
  expect(textSaveInfo('../../etc/passwd')).toBeNull()
})
