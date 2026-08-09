import { describe, expect, test } from 'vitest'
import { buildTrashFormData, parseBackUrl, parseSelectedItemNos } from './itemSelection'

function form(entries: Array<[string, string]>): FormData {
  const fd = new FormData()
  for (const [key, value] of entries) {
    fd.append(key, value)
  }
  return fd
}

describe('parseSelectedItemNos', () => {
  test('選択された itemNo をフォーム順で返す', () => {
    expect(parseSelectedItemNos(form([['itemNo', '1'], ['itemNo', '2']]))).toEqual(['1', '2'])
  })

  test('不正な itemNo を除き、重複はまとめる', () => {
    const fd = form([
      ['itemNo', '1'],
      ['itemNo', '1'],
      ['itemNo', 'bad id!'],
      ['itemNo', '2'],
    ])
    expect(parseSelectedItemNos(fd)).toEqual(['1', '2'])
  })

  test('選択が無ければ空', () => {
    expect(parseSelectedItemNos(form([]))).toEqual([])
  })

  test('異常に多い itemNo は上限で打ち切る (DoS 防御)', () => {
    // 上限 5000 はオンデマンド表示 (docs/33) の「読み込んだ全件から選べる」
    // を妨げない値。正当な選択が全ノート規模に及ぶため
    const fd = form(Array.from({ length: 6000 }, (_, i): [string, string] => ['itemNo', `${i}`]))
    expect(parseSelectedItemNos(fd).length).toBe(5000)
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
    expect(parseBackUrl(fd)).toBe('/?q=%E6%8A%B5%E6%8A%97&page=3&sort=itemNo')
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
  test('選んだ 1 件を itemNo に載せる', () => {
    expect(buildTrashFormData('42', { q: '', page: 1, sort: 'updated' }).getAll('itemNo')).toEqual(['42'])
  })

  // ここが本題。載せ忘れると parseBackUrl が素の / を返し、検索して 1 件
  // 消しただけで全件の先頭へ飛ばされる (行の削除だけこれが抜けていた)
  test('検索状態をそのまま往復できる (削除後に同じ一覧へ戻る)', () => {
    const fd = buildTrashFormData('42', { q: '抵抗', page: 3, sort: 'itemNo' })
    expect(parseBackUrl(fd)).toBe('/?q=%E6%8A%B5%E6%8A%97&page=3&sort=itemNo')
  })

  test('検索していないときは一覧の先頭へ戻る', () => {
    const fd = buildTrashFormData('42', { q: '', page: 1, sort: 'updated' })
    expect(parseBackUrl(fd)).toBe('/')
  })
})
