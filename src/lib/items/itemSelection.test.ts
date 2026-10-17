import { describe, expect, test } from 'vitest'
import { buildTrashFormData, parseBackUrl, parseSelectedItemIds } from './itemSelection'

function form(entries: Array<[string, string]>): FormData {
  const fd = new FormData()
  for (const [key, value] of entries) {
    fd.append(key, value)
  }
  return fd
}

describe('parseSelectedItemIds', () => {
  test('選択された itemId をフォーム順で返す', () => {
    expect(parseSelectedItemIds(form([['itemId', '00000000-0000-7000-8000-000000000001'], ['itemId', '00000000-0000-7000-8000-000000000002']]))).toEqual(['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002'])
  })

  test('不正な itemId を除き、重複はまとめる', () => {
    const fd = form([
      ['itemId', '00000000-0000-7000-8000-000000000001'],
      ['itemId', '00000000-0000-7000-8000-000000000001'],
      ['itemId', 'bad id!'],
      ['itemId', '00000000-0000-7000-8000-000000000002'],
    ])
    expect(parseSelectedItemIds(fd)).toEqual(['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002'])
  })

  test('選択が無ければ空', () => {
    expect(parseSelectedItemIds(form([]))).toEqual([])
  })

  test('異常に多い itemId は上限で打ち切る (DoS 防御)', () => {
    // 上限 5000 はオンデマンド表示 (docs/33) の「読み込んだ全件から選べる」
    // を妨げない値。正当な選択が全ノート規模に及ぶため
    const fd = form(Array.from({ length: 6000 }, (_, i): [string, string] => ['itemId', `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`]))
    expect(parseSelectedItemIds(fd).length).toBe(5000)
  })
})

describe('parseBackUrl', () => {
  test('q / page / sort が無ければ一覧の先頭', () => {
    expect(parseBackUrl(form([]))).toBe('/')
  })

  test('q / page / sort を反映する', () => {
    const fd = form([
      ['q', '抵抗'],
      ['page', '3'],
      ['sort', 'itemNo'],
    ])
    expect(parseBackUrl(fd)).toBe('/?q=%E6%8A%B5%E6%8A%97&page=3&sort=registered')
  })

  test('壊れた page は 1 ページ目にする', () => {
    expect(parseBackUrl(form([['page', 'abc']]))).toBe('/')
  })

  // back は必ずここで組み立て、フォームの値をそのまま redirect 先にしない
  // (任意の URL を受け取るとオープンリダイレクトになる)
  test('フォームの任意 URL は戻り先にならない', () => {
    const fd = form([
      ['back', 'https://evil.example.com'],
      ['q', 'x'],
    ])
    expect(parseBackUrl(fd)).toBe('/?q=x')
  })
})

describe('buildTrashFormData', () => {
  test('選んだ 1 件を itemId に載せる', () => {
    expect(buildTrashFormData('00000000-0000-7000-8000-000000000042', { q: '', page: 1, sort: 'updated' }).getAll('itemId')).toEqual(['00000000-0000-7000-8000-000000000042'])
  })

  // ここが本題。載せ忘れると parseBackUrl が素の / を返し、検索して 1 件
  // 消しただけで全件の先頭へ飛ばされる (行の削除だけこれが抜けていた)
  test('検索状態をそのまま往復できる (削除後に同じ一覧へ戻る)', () => {
    const fd = buildTrashFormData('00000000-0000-7000-8000-000000000042', { q: '抵抗', page: 3, sort: 'registered' })
    expect(parseBackUrl(fd)).toBe('/?q=%E6%8A%B5%E6%8A%97&page=3&sort=registered')
  })

  test('検索していないときは一覧の先頭へ戻る', () => {
    const fd = buildTrashFormData('00000000-0000-7000-8000-000000000042', { q: '', page: 1, sort: 'updated' })
    expect(parseBackUrl(fd)).toBe('/')
  })
})
