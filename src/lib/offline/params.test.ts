import { describe, expect, test } from 'vitest'

import { offlineRouteUrl, readOfflineRoute } from './params'

const ID = '00000000-0000-7000-8000-000000004518'

describe('readOfflineRoute', () => {
  test('何も無ければ一覧の初期状態', () => {
    expect(readOfflineRoute('')).toEqual({ query: '', itemId: null })
    expect(readOfflineRoute('?')).toEqual({ query: '', itemId: null })
  })

  test('q は検索語として読む', () => {
    expect(readOfflineRoute('?q=%23bjt')).toEqual({ query: '#bjt', itemId: null })
  })

  // sw.js が /item/<itemId> を取れなかったときに ?item=<itemId> へ翻訳して送ってくる。
  // 圏外でシールを読んでも、そのノートがそのまま開くのがこの経路の目的
  test('item は開くノートとして読む', () => {
    expect(readOfflineRoute(`?item=${ID}`)).toEqual({ query: '', itemId: ID })
    expect(readOfflineRoute(`?q=%E6%8A%B5%E6%8A%97&item=${ID}`)).toEqual({
      query: '抵抗',
      itemId: ID,
    })
  })

  // URL は誰でも書き換えられる外部入力。書式の合わないものは無視して一覧を出す
  test('itemId の書式に合わない値は無視する', () => {
    expect(readOfflineRoute('?item=../etc/passwd').itemId).toBeNull()
    expect(readOfflineRoute('?item=').itemId).toBeNull()
  })

  // オフラインの写しは UUID で引く。旧番号のシール (/item/1003) の読み替えは
  // サーバー側 (タグ検索) の仕事で、圏外では引けない
  test('旧番号は受けない (UUID だけ)', () => {
    expect(readOfflineRoute('?item=4518').itemId).toBeNull()
    expect(readOfflineRoute('?item=0192F5E8-7A3B-7C4D-8E5F-0123456789AB').itemId).toBeNull()
  })
})

describe('offlineRouteUrl', () => {
  test('空の状態は素の /offline', () => {
    expect(offlineRouteUrl({ query: '', itemId: null })).toBe('/offline')
  })

  test('検索語とノートを載せる', () => {
    expect(offlineRouteUrl({ query: '#bjt', itemId: null })).toBe('/offline?q=%23bjt')
    expect(offlineRouteUrl({ query: '', itemId: ID })).toBe(`/offline?item=${ID}`)
  })

  // 一覧へ戻ったときに検索語が残っていないと、開くたびに探し直しになる
  test('ノートを開いても検索語は保つ', () => {
    expect(offlineRouteUrl({ query: '抵抗', itemId: ID })).toBe(
      `/offline?q=%E6%8A%B5%E6%8A%97&item=${ID}`,
    )
  })

  test('読み書きが往復する', () => {
    const route = { query: '#bjt 1608', itemId: ID }
    const url = offlineRouteUrl(route)
    expect(readOfflineRoute(url.slice(url.indexOf('?')))).toEqual(route)
  })
})
