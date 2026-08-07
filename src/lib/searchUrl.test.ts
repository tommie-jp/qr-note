import { describe, expect, test } from 'vitest'
import { buildItemUrl, buildSearchUrl } from './searchUrl'

test('既定値 (page=1 / sort=updated) は省略する', () => {
  expect(buildSearchUrl('', 1, 'updated')).toBe('/')
  expect(buildSearchUrl('抵抗', 1, 'updated')).toBe('/?q=%E6%8A%B5%E6%8A%97')
})

test('page と sort が既定でなければ付ける', () => {
  expect(buildSearchUrl('bjt', 3, 'itemNo')).toBe('/?q=bjt&page=3&sort=itemNo')
})

test('クエリが空でも page/sort は付く', () => {
  expect(buildSearchUrl('', 2, 'updated')).toBe('/?page=2')
})

// アクセス順 (docs/37-アクセス順計画.md)。既定ではないので URL に載る
test('アクセス順は sort=accessed として付く', () => {
  expect(buildSearchUrl('', 1, 'accessed')).toBe('/?sort=accessed')
})

// 一覧からノートを開くときに検索状態を持ち回す (docs/60-学習進捗計画.md §4)。
// この `q` があるかどうかで、ノート側が前後ナビを出すかを決める
describe('buildItemUrl', () => {
  test('検索していないときは素の URL (前後ナビも出ない)', () => {
    expect(buildItemUrl('42', '', 'updated')).toBe('/item/42')
    expect(buildItemUrl('42', '   ', 'updated')).toBe('/item/42')
  })

  test('検索語を載せる', () => {
    expect(buildItemUrl('42', '#英単語 is:todo', 'updated')).toBe(
      '/item/42?q=%23%E8%8B%B1%E5%8D%98%E8%AA%9E+is%3Atodo',
    )
  })

  test('既定でない並び順も載せる (一覧と順序を揃えるため)', () => {
    expect(buildItemUrl('42', 'bjt', 'itemNo')).toBe('/item/42?q=bjt&sort=itemNo')
    expect(buildItemUrl('42', 'bjt', 'accessed')).toBe(
      '/item/42?q=bjt&sort=accessed',
    )
  })

  // 並び順だけでは前後ナビを出せない (q が無ければ一覧の文脈が無い) ので、
  // 空クエリのときは sort も載せない。素の URL に揃える
  test('クエリが空なら sort も載せない', () => {
    expect(buildItemUrl('42', '', 'itemNo')).toBe('/item/42')
  })

  test('itemNo は URL エンコードする', () => {
    expect(buildItemUrl('a b', 'bjt', 'updated')).toBe('/item/a%20b?q=bjt')
  })
})
