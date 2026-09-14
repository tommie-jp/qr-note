import { expect, test } from 'vitest'
import { parseYahooShoppingResponse, yahooShoppingUrl } from './yahooShopping'

// 実応答の形 (2026-07 に JAN 4901777018686 で取得したものを要約)。
// 使わない項目 (price / review / point など) は落としてある
const realResponse = {
  totalResultsAvailable: 76,
  totalResultsReturned: 1,
  firstResultsPosition: 1,
  request: { query: '' },
  hits: [
    {
      index: 1,
      name: 'サントリー 天然水 2L 2000ml ペットボトル 9本 1ケース 送料無料 水源指定不可',
      description: 'サントリー 天然水 2 リットル ミネラルウォーター',
      url: 'https://store.shopping.yahoo.co.jp/felicity-y/suf0417.html',
      inStock: true,
      condition: 'new',
      brand: { id: 15927, name: 'サントリー天然水' },
      genreCategory: { id: 17587, name: 'ミネラルウォーター、水', depth: 4 },
    },
  ],
}

test('実応答から商品名・ブランドを取り出す', () => {
  expect(parseYahooShoppingResponse(realResponse)).toEqual({
    title:
      'サントリー 天然水 2L 2000ml ペットボトル 9本 1ケース 送料無料 水源指定不可',
    brand: 'サントリー天然水',
  })
})

test('0 件 (hits が空) は null', () => {
  // 収録漏れ。エラーではない
  expect(parseYahooShoppingResponse({ totalResultsAvailable: 0, hits: [] })).toBe(
    null,
  )
})

test('応答がオブジェクトでなければ null (型を信用しない)', () => {
  expect(parseYahooShoppingResponse(null)).toBe(null)
  expect(parseYahooShoppingResponse('error')).toBe(null)
  expect(parseYahooShoppingResponse([realResponse])).toBe(null)
})

test('hits が配列でなければ null', () => {
  expect(parseYahooShoppingResponse({ hits: 'broken' })).toBe(null)
  expect(parseYahooShoppingResponse({})).toBe(null)
})

test('商品名が無いものは null (1 行目に置くものが無い)', () => {
  expect(
    parseYahooShoppingResponse({ hits: [{ brand: { name: 'ブランド' } }] }),
  ).toBe(null)
  expect(parseYahooShoppingResponse({ hits: [{ name: '' }] })).toBe(null)
  expect(parseYahooShoppingResponse({ hits: [{ name: 123 }] })).toBe(null)
})

test('ブランドが無くても商品名だけで成立する', () => {
  expect(parseYahooShoppingResponse({ hits: [{ name: '商品' }] })).toEqual({
    title: '商品',
    brand: '',
  })
  expect(
    parseYahooShoppingResponse({ hits: [{ name: '商品', brand: { name: 42 } }] }),
  ).toEqual({ title: '商品', brand: '' })
})

test('URL は jan_code と appid を載せて 1 件だけ受け取る', () => {
  const url = yahooShoppingUrl('4901777018686', 'test&app=id')
  expect(url).toContain(
    'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?',
  )
  expect(url).toContain('jan_code=4901777018686')
  expect(url).toContain('appid=test%26app%3Did') // エンコード漏れで壊れない
  expect(url).toContain('results=1')
})
