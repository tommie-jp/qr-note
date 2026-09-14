import { describe, expect, test } from 'vitest'
import { SAVED_LIMIT, SUGGEST_COUNT, type QueryLists } from '@/lib/searchQueries'
import {
  insertTextOf,
  listDropdown,
  MAX_CANDIDATES,
  moveActive,
  reflectSavedLists,
  suggestDropdown,
  tabAction,
  toggleSavedLists,
  withSavedFull,
  type Dropdown,
} from './suggest'

const LISTS: QueryLists = { saved: ['#bjt'], recent: ['抵抗', 'コンデンサ'] }
const TAGS = ['bjt', 'bjt-npn', 'npn', '抵抗']

const numbered = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe('insertTextOf', () => {
  test('タグだけ # を付けて挿入する', () => {
    // Act / Assert
    expect(insertTextOf({ kind: 'tag', value: 'bjt' })).toBe('#bjt')
    expect(insertTextOf({ kind: 'keyword', value: 'is:todo' })).toBe('is:todo')
    expect(insertTextOf({ kind: 'recent', value: '抵抗' })).toBe('抵抗')
  })
})

describe('listDropdown', () => {
  test('登録パターン → 最近の検索の順に並べ、未選択で開く', () => {
    // Act
    const dd = listDropdown(LISTS)

    // Assert
    expect(dd).toEqual({
      token: null,
      list: { expanded: false, hasMore: false, savedFull: false },
      items: [
        { kind: 'saved', value: '#bjt' },
        { kind: 'recent', value: '抵抗' },
        { kind: 'recent', value: 'コンデンサ' },
      ],
      active: -1,
    })
  })

  test('まだ読めていない (null) なら出さない', () => {
    // Act / Assert
    expect(listDropdown(null)).toBeNull()
  })

  test('候補が 1 つも無ければ空の枠を出さない', () => {
    // Act / Assert
    expect(listDropdown({ saved: [], recent: [] })).toBeNull()
  })

  test('畳んでいる分があれば hasMore を立て、expanded で全部出す', () => {
    // Arrange
    const lists = { saved: [], recent: numbered('r', SUGGEST_COUNT + 2) }

    // Act
    const folded = listDropdown(lists)
    const expanded = listDropdown(lists, true)

    // Assert
    expect(folded?.items).toHaveLength(SUGGEST_COUNT)
    expect(folded?.list).toMatchObject({ expanded: false, hasMore: true })
    expect(expanded?.items).toHaveLength(SUGGEST_COUNT + 2)
    expect(expanded?.list).toMatchObject({ expanded: true, hasMore: false })
  })

  test('満杯かは出ている ★ の数ではなく登録の全件で見る', () => {
    // Arrange
    const lists = { saved: numbered('s', SAVED_LIMIT), recent: [] }

    // Act
    const dd = listDropdown(lists)

    // Assert
    expect(dd?.items).toHaveLength(SUGGEST_COUNT)
    expect(dd?.list?.savedFull).toBe(true)
  })
})

describe('suggestDropdown', () => {
  test('# を打ちかけたらタグ候補を出し、トークンの範囲を持つ', () => {
    // Act
    const dd = suggestDropdown('抵抗 #bj', 6, TAGS, LISTS)

    // Assert
    expect(dd).toEqual({
      token: { range: { start: 3, end: 6, prefix: 'bj' }, typed: '#bj' },
      list: null,
      items: [
        { kind: 'tag', value: 'bjt' },
        { kind: 'tag', value: 'bjt-npn' },
      ],
      active: -1,
    })
  })

  test('タグ候補は MAX_CANDIDATES 件までに絞る', () => {
    // Arrange
    const tags = numbered('t', MAX_CANDIDATES + 3)

    // Act
    const dd = suggestDropdown('#', 1, tags, LISTS)

    // Assert
    expect(dd?.items).toHaveLength(MAX_CANDIDATES)
  })

  test('打ち終わったタグ 1 つだけが残る形では出さない', () => {
    // Act / Assert
    expect(suggestDropdown('#npn', 4, TAGS, LISTS)).toBeNull()
  })

  test('前方一致が複数あれば打ち終わったタグでも出す (Tab で伸ばせるように)', () => {
    // Act
    const dd = suggestDropdown('#bjt', 4, TAGS, LISTS)

    // Assert
    expect(dd?.items.map((s) => s.value)).toEqual(['bjt', 'bjt-npn'])
  })

  test('当たるタグが無ければ閉じる (一覧へは落ちない)', () => {
    // Act / Assert
    expect(suggestDropdown('#zzz', 4, TAGS, LISTS)).toBeNull()
  })

  test('キーワードを打ちかけたらキーワード候補を出す', () => {
    // Act
    const dd = suggestDropdown('is:t', 4, TAGS, LISTS)

    // Assert
    expect(dd).toEqual({
      token: { range: { start: 0, end: 4, prefix: 'is:t' }, typed: 'is:t' },
      list: null,
      items: [{ kind: 'keyword', value: 'is:todo' }],
      active: -1,
    })
  })

  test('窓が空 (空白だけ) なら一覧を出す', () => {
    // Act / Assert
    expect(suggestDropdown('  ', 2, TAGS, LISTS)).toEqual(listDropdown(LISTS))
  })

  test('補完の文脈が無い語を打っている間は何も出さない', () => {
    // Act / Assert
    expect(suggestDropdown('抵抗', 2, TAGS, LISTS)).toBeNull()
  })
})

describe('moveActive', () => {
  const dd = listDropdown(LISTS) as Dropdown

  test('↓ は未選択から先頭へ進み、末尾から先頭へ回り込む', () => {
    // Act
    const first = moveActive(dd, 1)
    const wrapped = moveActive({ ...dd, active: 2 }, 1)

    // Assert
    expect(first.active).toBe(0)
    expect(wrapped.active).toBe(0)
  })

  test('↑ は未選択からも先頭からも末尾へ飛ぶ', () => {
    // Act / Assert
    expect(moveActive(dd, -1).active).toBe(2)
    expect(moveActive({ ...dd, active: 0 }, -1).active).toBe(2)
    expect(moveActive({ ...dd, active: 2 }, -1).active).toBe(1)
  })

  test('元のドロップダウンは書き換えない', () => {
    // Act
    moveActive(dd, 1)

    // Assert
    expect(dd.active).toBe(-1)
  })
})

describe('tabAction', () => {
  test('一覧を出しているときは Tab を横取りしない', () => {
    // Arrange
    const dd = listDropdown(LISTS) as Dropdown

    // Act / Assert
    expect(tabAction('', dd)).toEqual({ kind: 'ignore' })
  })

  test('候補が 1 つならそれで確定する', () => {
    // Arrange
    const dd = suggestDropdown('is:t', 4, TAGS, LISTS) as Dropdown

    // Act / Assert
    expect(tabAction('is:t', dd)).toEqual({
      kind: 'accept',
      suggestion: { kind: 'keyword', value: 'is:todo' },
    })
  })

  test('複数なら最長共通プレフィックスまで伸ばす', () => {
    // Arrange
    const dd = suggestDropdown('a #b', 4, TAGS, LISTS) as Dropdown

    // Act / Assert
    expect(tabAction('a #b', dd)).toEqual({
      kind: 'extend',
      completion: { query: 'a #bjt', cursor: 6 },
    })
  })

  test('既に共通部分まで打ってあれば何もしない', () => {
    // Arrange
    const dd = suggestDropdown('#bjt', 4, TAGS, LISTS) as Dropdown

    // Act / Assert
    expect(tabAction('#bjt', dd)).toEqual({ kind: 'stay' })
  })
})

describe('toggleSavedLists', () => {
  test('最近の検索を登録パターンの先頭へ足す (履歴はそのまま)', () => {
    // Act
    const next = toggleSavedLists(LISTS, { kind: 'recent', value: '抵抗' })

    // Assert
    expect(next).toEqual({ saved: ['抵抗', '#bjt'], recent: ['抵抗', 'コンデンサ'] })
  })

  test('外した登録パターンは履歴の先頭へ入れ直す', () => {
    // Act
    const next = toggleSavedLists(LISTS, { kind: 'saved', value: '#bjt' })

    // Assert
    expect(next).toEqual({ saved: [], recent: ['#bjt', '抵抗', 'コンデンサ'] })
  })

  test('渡したリストは書き換えない', () => {
    // Arrange
    const lists = { saved: ['#bjt'], recent: ['抵抗'] }

    // Act
    toggleSavedLists(lists, { kind: 'saved', value: '#bjt' })

    // Assert
    expect(lists).toEqual({ saved: ['#bjt'], recent: ['抵抗'] })
  })
})

describe('withSavedFull / reflectSavedLists', () => {
  test('満杯の印だけを立て、並びは変えない', () => {
    // Arrange
    const dd = listDropdown(LISTS) as Dropdown

    // Act
    const full = withSavedFull(dd)

    // Assert
    expect(full.list?.savedFull).toBe(true)
    expect(full.items).toEqual(dd.items)
  })

  test('切り替えた後も行の並びは動かさず、★/🕐 の種類だけ差し替える', () => {
    // Arrange
    const dd = { ...(listDropdown(LISTS) as Dropdown), active: 1 }
    const next = toggleSavedLists(LISTS, { kind: 'recent', value: '抵抗' })

    // Act
    const reflected = reflectSavedLists(dd, next)

    // Assert
    expect(reflected.items).toEqual([
      { kind: 'saved', value: '#bjt' },
      { kind: 'saved', value: '抵抗' },
      { kind: 'recent', value: 'コンデンサ' },
    ])
    expect(reflected.active).toBe(1)
  })

  test('切り替えで満杯になったら savedFull を立てる', () => {
    // Arrange
    const lists = { saved: numbered('s', SAVED_LIMIT - 1), recent: ['抵抗'] }
    const dd = listDropdown(lists) as Dropdown
    const next = toggleSavedLists(lists, { kind: 'recent', value: '抵抗' })

    // Act
    const reflected = reflectSavedLists(dd, next)

    // Assert
    expect(dd.list?.savedFull).toBe(false)
    expect(reflected.list?.savedFull).toBe(true)
  })

  test('補完 (list が null) では一覧の状態を作らない', () => {
    // Arrange
    const dd = suggestDropdown('#bj', 3, TAGS, LISTS) as Dropdown

    // Act / Assert
    expect(withSavedFull(dd).list).toBeNull()
  })
})
