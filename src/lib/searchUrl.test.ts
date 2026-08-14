import { describe, expect, test } from 'vitest'
import { narrowToChecks } from './search'
import { buildItemUrl, buildSearchUrl, buildTrashUrl, itemNoFromPathname } from './searchUrl'

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

  // 進捗の表の行リンク (docs/77-進捗マトリックス計画.md §7)。フェンスの
  // 検索式が空でも「チェックを持つ」条件が式として載るので、**並び順が落ちない**
  // — 落ちるとノート側が cookie の並びで前後を求め、表と順序が食い違う
  test('表の行リンクは空の検索式でも並び順を保つ', () => {
    expect(buildItemUrl('42', narrowToChecks(''), 'itemNo')).toBe(
      '/item/42?q=is%3Atodo+OR+is%3Adone&sort=itemNo',
    )
  })

  test('itemNo は URL エンコードする', () => {
    expect(buildItemUrl('a b', 'bjt', 'updated')).toBe('/item/a%20b?q=bjt')
  })
})

// ゴミ箱 (docs/67-ゴミ箱表示形式計画.md §2)。持ち回すのは並び順だけ
describe('buildTrashUrl', () => {
  test('既定 (削除順) は素の /trash に畳む', () => {
    expect(buildTrashUrl('deleted')).toBe('/trash')
  })

  test('既定でない並びは ?sort= に載せる', () => {
    expect(buildTrashUrl('deletedAsc')).toBe('/trash?sort=deletedAsc')
    expect(buildTrashUrl('itemNo')).toBe('/trash?sort=itemNo')
  })
})

// どのノートが開いているかの共通の読み取り (docs/86 §4)
describe('itemNoFromPathname', () => {
  test('/item/<番号> なら番号を返す (エンコードは戻す)', () => {
    expect(itemNoFromPathname('/item/4951')).toBe('4951')
    expect(itemNoFromPathname('/item/a%20b')).toBe('a b')
  })

  test('デコードできない % はそのまま番号として返す (二重デコードで落とさない)', () => {
    // usePathname がデコード済みを返す環境で、旧 itemNo が % を含む場合
    expect(itemNoFromPathname('/item/50%')).toBe('50%')
  })

  test('/item の深い階層 (履歴など) や別ルートは null', () => {
    expect(itemNoFromPathname('/item/4951/history')).toBe(null)
    expect(itemNoFromPathname('/item/')).toBe(null)
    expect(itemNoFromPathname('/')).toBe(null)
    expect(itemNoFromPathname('/trash')).toBe(null)
    expect(itemNoFromPathname(null)).toBe(null)
  })
})
