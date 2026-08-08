import { describe, expect, test } from 'vitest'

import { offlineRouteUrl, readOfflineRoute } from './params'

describe('readOfflineRoute', () => {
  test('何も無ければ一覧の初期状態', () => {
    expect(readOfflineRoute('')).toEqual({ query: '', itemNo: null })
    expect(readOfflineRoute('?')).toEqual({ query: '', itemNo: null })
  })

  test('q は検索語として読む', () => {
    expect(readOfflineRoute('?q=%23bjt')).toEqual({ query: '#bjt', itemNo: null })
  })

  // sw.js が /item/4518 を取れなかったときに ?item=4518 へ翻訳して送ってくる。
  // 圏外でシールを読んでも、そのノートがそのまま開くのがこの経路の目的
  test('item は開くノートとして読む', () => {
    expect(readOfflineRoute('?item=4518')).toEqual({ query: '', itemNo: '4518' })
    expect(readOfflineRoute('?q=%E6%8A%B5%E6%8A%97&item=4518')).toEqual({
      query: '抵抗',
      itemNo: '4518',
    })
  })

  // URL は誰でも書き換えられる外部入力。書式の合わないものは無視して一覧を出す
  test('itemNo の書式に合わない値は無視する', () => {
    expect(readOfflineRoute('?item=../etc/passwd').itemNo).toBeNull()
    expect(readOfflineRoute('?item=').itemNo).toBeNull()
  })
})

describe('offlineRouteUrl', () => {
  test('空の状態は素の /offline', () => {
    expect(offlineRouteUrl({ query: '', itemNo: null })).toBe('/offline')
  })

  test('検索語とノートを載せる', () => {
    expect(offlineRouteUrl({ query: '#bjt', itemNo: null })).toBe('/offline?q=%23bjt')
    expect(offlineRouteUrl({ query: '', itemNo: '4518' })).toBe('/offline?item=4518')
  })

  // 一覧へ戻ったときに検索語が残っていないと、開くたびに探し直しになる
  test('ノートを開いても検索語は保つ', () => {
    expect(offlineRouteUrl({ query: '抵抗', itemNo: '4518' })).toBe(
      '/offline?q=%E6%8A%B5%E6%8A%97&item=4518',
    )
  })

  test('読み書きが往復する', () => {
    const route = { query: '#bjt 1608', itemNo: '4518' }
    const url = offlineRouteUrl(route)
    expect(readOfflineRoute(url.slice(url.indexOf('?')))).toEqual(route)
  })
})
