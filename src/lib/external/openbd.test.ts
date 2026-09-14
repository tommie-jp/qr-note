import { expect, test } from 'vitest'
import { openBdUrl, parseOpenBdResponse } from './openbd'

// 実際の応答 (api.openbd.jp/v1/get?isbn=9784873115658) から必要な枝だけ抜いたもの
const response = (overrides: Record<string, unknown> = {}) => [
  {
    summary: {
      isbn: '9784873115658',
      title: 'リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック',
      volume: '',
      series: 'THEORY/IN/PRACTICE',
      publisher: 'オーム社',
      pubdate: '201206',
      cover: '',
      author: 'Boswell,Dustin Foucher,Trevor 角,征典',
      ...overrides,
    },
    onix: {
      DescriptiveDetail: {
        Contributor: [
          { SequenceNumber: '1', PersonName: { content: 'Boswell, Dustin' } },
          { SequenceNumber: '2', PersonName: { content: 'Foucher, Trevor' } },
          { SequenceNumber: '3', PersonName: { content: '角, 征典' } },
        ],
      },
    },
  },
]

test('リンク先は openBD の get エンドポイント', () => {
  expect(openBdUrl('9784873115658')).toBe(
    'https://api.openbd.jp/v1/get?isbn=9784873115658',
  )
})

test('応答から書名・著者・出版社・刊行年月を取り出す', () => {
  expect(parseOpenBdResponse(response())).toEqual({
    title:
      'リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック',
    authors: ['Boswell, Dustin', 'Foucher, Trevor', '角, 征典'],
    publisher: 'オーム社',
    pubdate: '2012.06',
  })
})

test('著者は summary.author ではなく ONIX の Contributor から取る', () => {
  // summary.author は "Boswell,Dustin Foucher,Trevor 角,征典" と著者名が
  // 空白で連結されていて、区切り位置が判定できない (名前自体に空白が入りうる)。
  // ONIX は 1 人 1 要素の配列なので確実に分けられる
  const book = parseOpenBdResponse(response())
  expect(book?.authors).toHaveLength(3)
  expect(book?.authors[0]).toBe('Boswell, Dustin')
})

test('ONIX に Contributor が無ければ summary.author をそのまま使う', () => {
  // 分割できないので 1 人分として扱う。無理に空白で切ると名前が壊れる
  const json = [{ summary: response()[0].summary, onix: {} }]
  expect(parseOpenBdResponse(json)?.authors).toEqual([
    'Boswell,Dustin Foucher,Trevor 角,征典',
  ])
})

test('著者情報がどこにも無ければ空配列', () => {
  const json = [{ summary: { ...response()[0].summary, author: '' }, onix: {} }]
  expect(parseOpenBdResponse(json)?.authors).toEqual([])
})

test('収録されていない ISBN (要素が null) は null', () => {
  // openBD は版元ドットコム系のデータが中心で、収録漏れが実際にある
  expect(parseOpenBdResponse([null])).toBeNull()
})

test('空配列・配列でない応答は null', () => {
  expect(parseOpenBdResponse([])).toBeNull()
  expect(parseOpenBdResponse({})).toBeNull()
  expect(parseOpenBdResponse(null)).toBeNull()
  expect(parseOpenBdResponse('<html>error</html>')).toBeNull()
})

test('書名が無い応答は null (本文の 1 行目に置くものが無い)', () => {
  expect(parseOpenBdResponse(response({ title: '' }))).toBeNull()
  expect(parseOpenBdResponse([{ onix: {} }])).toBeNull()
})

test('文字列でない値は無視する (外部データを信用しない)', () => {
  const json = [
    {
      summary: { title: 'ダミー本', publisher: 42, pubdate: null },
      onix: { DescriptiveDetail: { Contributor: 'not-an-array' } },
    },
  ]
  expect(parseOpenBdResponse(json)).toEqual({
    title: 'ダミー本',
    authors: [],
    publisher: '',
    pubdate: '',
  })
})

test('書影 (summary.cover) があれば書影 URL として取り出す', () => {
  // 実測では cover が入るのはホワイトリスト版元だけ (11 冊中 1 冊)。
  // 空のほうが多数派なので、あるときだけ付ける (docs/19-書影取得計画.md §1)
  const json = response({ cover: 'https://cover.openbd.jp/9784861827754.jpg' })
  expect(parseOpenBdResponse(json)?.coverUrl).toBe(
    'https://cover.openbd.jp/9784861827754.jpg',
  )
})

test('書影が空・文字列でないときは書影 URL を付けない', () => {
  expect(parseOpenBdResponse(response())?.coverUrl).toBeUndefined()
  expect(parseOpenBdResponse(response({ cover: 42 }))?.coverUrl).toBeUndefined()
})

// 刊行日の整形 (formatPubdate) は NDL と共通なので external/book.test.ts で見る
