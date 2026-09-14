import { expect, test } from 'vitest'
import { ndlSearchUrl, parseNdlSearchResponse } from './ndlSearch'

// 実応答 (ndlsearch.ndl.go.jp/api/opensearch?isbn=...) から必要な枝だけ抜いたもの
const response = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcndl="http://ndl.go.jp/dcndl/terms/"
  xmlns:dcterms="http://purl.org/dc/terms/">
  <channel>
    <title>ISBN検索</title>
    ${items}
  </channel>
</rss>`

const item = `
  <item>
    <title>アーキテクチャとプログラミングの基礎</title>
    <author>大野, 浩,大野浩 著</author>
    <dc:title>アーキテクチャとプログラミングの基礎</dc:title>
    <dc:creator>大野, 浩</dc:creator>
    <dc:publisher>アスキー</dc:publisher>
    <dc:date xsi:type="dcterms:W3CDTF">1996</dc:date>
    <dcterms:issued xsi:type="dcterms:W3CDTF">1996.2</dcterms:issued>
  </item>`

test('OpenSearch の URL は ISBN で 1 件だけ求める', () => {
  const url = new URL(ndlSearchUrl('9784873115658'))
  expect(url.origin + url.pathname).toBe('https://ndlsearch.ndl.go.jp/api/opensearch')
  expect(url.searchParams.get('isbn')).toBe('9784873115658')
  expect(url.searchParams.get('cnt')).toBe('1')
})

test('応答から書名・著者・出版社・刊行年月を取り出す', () => {
  expect(parseNdlSearchResponse(response(item))).toEqual({
    title: 'アーキテクチャとプログラミングの基礎',
    authors: ['大野, 浩'],
    publisher: 'アスキー',
    pubdate: '1996.02',
  })
})

test('刊行年月は dc:date (年だけ) ではなく dcterms:issued を使う', () => {
  // dc:date は "1996"、dcterms:issued は "1996.2"。細かいほうを採る
  expect(parseNdlSearchResponse(response(item))?.pubdate).toBe('1996.02')
})

test('dcterms:issued が無ければ dc:date に退避する', () => {
  const noIssued = item.replace(/<dcterms:issued[^>]*>[^<]*<\/dcterms:issued>/, '')
  expect(parseNdlSearchResponse(response(noIssued))?.pubdate).toBe('1996')
})

test('10 月が 1 月に化けない (XML の値を数値にしない)', () => {
  // fast-xml-parser は既定で "1996.10" を数値 1996.1 として読む。
  // そのままだと 10 月が 1 月になる。parseTagValue: false で防いでいる
  const october = item.replace('1996.2</dcterms:issued>', '1996.10</dcterms:issued>')
  expect(parseNdlSearchResponse(response(october))?.pubdate).toBe('1996.10')
})

test('著者が複数なら順に並べる', () => {
  const two = item.replace(
    '<dc:creator>大野, 浩</dc:creator>',
    '<dc:creator>Boswell, Dustin</dc:creator><dc:creator>角, 征典</dc:creator>',
  )
  expect(parseNdlSearchResponse(response(two))?.authors).toEqual([
    'Boswell, Dustin',
    '角, 征典',
  ])
})

test('著者名の末尾の生没年は落とす', () => {
  // NDL は "尾田, 栄一郎, 1975-" と典拠の生年を付ける。openBD の ONIX は
  // "角, 征典" なので、2 つの API で本文の見た目を揃える
  const creator = (name: string) =>
    item.replace('<dc:creator>大野, 浩</dc:creator>', `<dc:creator>${name}</dc:creator>`)
  expect(parseNdlSearchResponse(response(creator('尾田, 栄一郎, 1975-')))?.authors).toEqual([
    '尾田, 栄一郎',
  ])
  expect(parseNdlSearchResponse(response(creator('夏目, 漱石, 1867-1916')))?.authors).toEqual([
    '夏目, 漱石',
  ])
})

test('生没年でない肩書きは残す', () => {
  const role = item.replace(
    '<dc:creator>大野, 浩</dc:creator>',
    '<dc:creator>大野, 浩, テクニカルライター</dc:creator>',
  )
  expect(parseNdlSearchResponse(response(role))?.authors).toEqual([
    '大野, 浩, テクニカルライター',
  ])
})

test('同じ ISBN に複数の記録があるときは最初の 1 件を使う', () => {
  // NDL には同一 ISBN に別の書名の記録が 2 つあることがある (実測)
  const second = item.replace(
    'アーキテクチャとプログラミングの基礎',
    'Windows 95プログラミング',
  )
  expect(parseNdlSearchResponse(response(item + second))?.title).toBe(
    'アーキテクチャとプログラミングの基礎',
  )
})

test('0 件の応答は null', () => {
  expect(parseNdlSearchResponse(response(''))).toBeNull()
})

test('書名が無い応答は null (本文の 1 行目に置くものが無い)', () => {
  const noTitle = item.replace(/<dc:title>[^<]*<\/dc:title>/, '')
  expect(parseNdlSearchResponse(response(noTitle))).toBeNull()
})

test('壊れた XML・XML でない応答は null (例外にしない)', () => {
  expect(parseNdlSearchResponse('<rss><channel>')).toBeNull()
  expect(parseNdlSearchResponse('')).toBeNull()
  expect(parseNdlSearchResponse('{"not":"xml"}')).toBeNull()
  expect(parseNdlSearchResponse('<html><body>error</body></html>')).toBeNull()
})

test('書名だけの記録でも返す', () => {
  const bare = '<item><dc:title>書名だけの本</dc:title></item>'
  expect(parseNdlSearchResponse(response(bare))).toEqual({
    title: '書名だけの本',
    authors: [],
    publisher: '',
    pubdate: '',
  })
})
