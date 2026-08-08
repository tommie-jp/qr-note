import { describe, expect, test } from 'vitest'
import {
  addRecentQuery,
  addSavedQuery,
  applyQueryUse,
  isRecordableQuery,
  isSavedFull,
  MAX_QUERY_LENGTH,
  QUERY_LIMIT,
  removeSavedQuery,
  sanitizeQueryList,
  SAVED_LIMIT,
  splitSuggestions,
  touchSavedQuery,
  SUGGEST_COUNT,
} from './searchQueries'

describe('addRecentQuery', () => {
  test('puts a new query at the head', () => {
    // Arrange
    const list = ['抵抗']

    // Act
    const next = addRecentQuery(list, 'コンデンサ')

    // Assert
    expect(next).toEqual(['コンデンサ', '抵抗'])
  })

  test('does not mutate the given list', () => {
    const list = ['抵抗']

    addRecentQuery(list, 'コンデンサ')

    expect(list).toEqual(['抵抗'])
  })

  test('moves an existing query to the head instead of duplicating it', () => {
    const next = addRecentQuery(['a', '抵抗', 'b'], '抵抗')

    expect(next).toEqual(['抵抗', 'a', 'b'])
  })

  test('drops older entries that are a prefix of the new one', () => {
    // 打ちながら検索するので「電」「電験」が残骸として溜まる
    const next = addRecentQuery(['電験', '電', 'コンデンサ'], '電験三種')

    expect(next).toEqual(['電験三種', 'コンデンサ'])
  })

  test('keeps longer entries that extend the new one', () => {
    // 短く検索し直すのはそれ自体が新しい検索
    const next = addRecentQuery(['電験三種'], '電験')

    expect(next).toEqual(['電験', '電験三種'])
  })

  test('trims surrounding space', () => {
    expect(addRecentQuery([], '  抵抗 ')).toEqual(['抵抗'])
  })

  test('ignores an empty query', () => {
    expect(addRecentQuery(['抵抗'], '   ')).toEqual(['抵抗'])
  })

  test('caps the list at QUERY_LIMIT', () => {
    // Arrange … 互いに前方一致しない語で埋める
    const list = Array.from({ length: QUERY_LIMIT }, (_, i) => `q${i}-x`)

    // Act
    const next = addRecentQuery(list, 'new')

    // Assert
    expect(next).toHaveLength(QUERY_LIMIT)
    expect(next[0]).toBe('new')
    expect(next).not.toContain(`q${QUERY_LIMIT - 1}-x`)
  })
})

describe('addSavedQuery / touchSavedQuery / removeSavedQuery', () => {
  test('puts a newly registered pattern at the head (= just used)', () => {
    const next = addSavedQuery(['#英単語 is:todo'], 'is:done')

    expect(next).toEqual(['is:done', '#英単語 is:todo'])
  })

  test('moves a used pattern to the head', () => {
    expect(touchSavedQuery(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  test('leaves the list alone when the pattern is not registered', () => {
    expect(touchSavedQuery(['a', 'b'], 'z')).toEqual(['a', 'b'])
  })

  test('does not mutate the given list', () => {
    const list = ['a', 'b']

    touchSavedQuery(list, 'b')

    expect(list).toEqual(['a', 'b'])
  })

  test('does not register the same pattern twice', () => {
    const next = addSavedQuery(['is:todo'], 'is:todo')

    expect(next).toEqual(['is:todo'])
  })

  test('ignores an empty pattern', () => {
    expect(addSavedQuery(['is:todo'], '  ')).toEqual(['is:todo'])
  })

  test('caps the list at SAVED_LIMIT (= what もっと表示 can show)', () => {
    // 出し切れない数まで持てると「登録したのに出ない・外せない」が生まれる
    const list = Array.from({ length: SAVED_LIMIT }, (_, i) => `p${i}`)

    expect(addSavedQuery(list, 'new')).toEqual(list)
    expect(isSavedFull(list)).toBe(true)
  })

  test('is not full below the limit', () => {
    expect(isSavedFull(['a'])).toBe(false)
  })

  test('removes a registered pattern', () => {
    expect(removeSavedQuery(['a', 'b'], 'a')).toEqual(['b'])
  })

  test('leaves the list alone when the pattern is not registered', () => {
    expect(removeSavedQuery(['a'], 'b')).toEqual(['a'])
  })
})

describe('splitSuggestions', () => {
  // 上限いっぱいの一覧 (p0…/q0…)。SUGGEST_COUNT より多いので畳まれる
  const fullSaved = Array.from({ length: SAVED_LIMIT }, (_, i) => `p${i}`)
  const fullRecent = Array.from({ length: QUERY_LIMIT }, (_, i) => `q${i}`)

  test('shows SUGGEST_COUNT of each while collapsed', () => {
    // Act
    const r = splitSuggestions(fullSaved, fullRecent)

    // Assert
    expect(r.saved).toHaveLength(SUGGEST_COUNT)
    expect(r.recent).toHaveLength(SUGGEST_COUNT)
    expect(r.saved[0]).toBe('p0')
    expect(r.recent[0]).toBe('q0')
    expect(SUGGEST_COUNT).toBe(5)
  })

  test('says there is more to show when either list is longer', () => {
    expect(splitSuggestions(fullSaved, fullRecent).hasMore).toBe(true)
    expect(splitSuggestions(['s1'], ['r1']).hasMore).toBe(false)
  })

  test('shows everything once expanded, and then there is no more', () => {
    const r = splitSuggestions(fullSaved, fullRecent, true)

    expect(r.saved).toHaveLength(SAVED_LIMIT)
    expect(r.recent).toHaveLength(QUERY_LIMIT)
    expect(r.hasMore).toBe(false)
  })

  test('does not repeat a pattern that is also in the recent list', () => {
    // 登録したパターンはよく使う = 最近の検索にも必ず入るので、
    // 掃除しないと同じ物が 2 度並ぶ
    const r = splitSuggestions(['is:todo'], ['is:todo', 'r1', 'r2'])

    expect(r.recent).toEqual(['r1', 'r2'])
  })

  test('hides patterns that are themselves hidden by the fold', () => {
    // 畳んでいる間も「🕐 の行は必ず未登録」が成り立たないと、☆ が空振りする。
    // 引くのは表示分ではなく登録パターン全部
    const hidden = fullSaved[SAVED_LIMIT - 1]
    const r = splitSuggestions(fullSaved, [hidden, 'r1'])

    expect(r.saved).not.toContain(hidden) // 畳まれて出ていない
    expect(r.recent).toEqual(['r1']) // それでも 🕐 には出さない
  })
})

describe('applyQueryUse', () => {
  test('records an unregistered query at the head of the recent list', () => {
    // Arrange
    const lists = { saved: ['is:todo'], recent: ['抵抗'] }

    // Act
    const next = applyQueryUse(lists, 'コンデンサ')

    // Assert
    expect(next.recent).toEqual(['コンデンサ', '抵抗'])
    expect(next.saved).toEqual(['is:todo']) // 登録パターンは動かない
  })

  test('moves a registered pattern to the head instead of adding it to history', () => {
    // ★ の欄に出ている物が 🕐 の枠を見えないまま食うのを防ぐ (表示では
    // 登録済みを引くので、履歴に入れても必ず空振りになる)
    const lists = { saved: ['#発注', 'is:todo'], recent: ['抵抗'] }

    const next = applyQueryUse(lists, 'is:todo')

    expect(next.saved).toEqual(['is:todo', '#発注'])
    expect(next.recent).toEqual(['抵抗'])
  })

  test('ignores an empty query (the home link searches nothing)', () => {
    const lists = { saved: ['is:todo'], recent: ['抵抗'] }

    const next = applyQueryUse(lists, '   ')

    expect(next).toEqual(lists)
  })

  test('does not mutate the given lists', () => {
    const lists = { saved: ['is:todo'], recent: ['抵抗'] }

    applyQueryUse(lists, 'コンデンサ')

    expect(lists).toEqual({ saved: ['is:todo'], recent: ['抵抗'] })
  })

  test('caps the recent list at QUERY_LIMIT', () => {
    const recent = Array.from({ length: QUERY_LIMIT }, (_, i) => `q${i}`)

    const next = applyQueryUse({ saved: [], recent }, 'new')

    expect(next.recent).toHaveLength(QUERY_LIMIT)
    expect(next.recent[0]).toBe('new')
    expect(next.recent).not.toContain(`q${QUERY_LIMIT - 1}`)
  })
})

describe('isRecordableQuery', () => {
  test('accepts an ordinary query', () => {
    expect(isRecordableQuery('#抵抗 10k')).toBe(true)
  })

  test('rejects a blank query', () => {
    expect(isRecordableQuery('')).toBe(false)
    expect(isRecordableQuery('   ')).toBe(false)
  })

  test('rejects anything that is not a string (hand-crafted request)', () => {
    expect(isRecordableQuery(42)).toBe(false)
    expect(isRecordableQuery(null)).toBe(false)
    expect(isRecordableQuery(['抵抗'])).toBe(false)
  })

  test('rejects a pasted wall of text so it is not hoarded', () => {
    expect(isRecordableQuery('あ'.repeat(MAX_QUERY_LENGTH))).toBe(true)
    expect(isRecordableQuery('あ'.repeat(MAX_QUERY_LENGTH + 1))).toBe(false)
  })
})

describe('sanitizeQueryList', () => {
  test('keeps the order and trims each entry', () => {
    expect(sanitizeQueryList([' a ', 'b'])).toEqual(['a', 'b'])
  })

  test('drops entries that cannot be recorded', () => {
    expect(sanitizeQueryList(['a', '', 7, null, 'あ'.repeat(999)])).toEqual(['a'])
  })

  test('keeps the first of a duplicate (order carries meaning)', () => {
    expect(sanitizeQueryList(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  test('returns an empty list when the value is not an array', () => {
    expect(sanitizeQueryList('a')).toEqual([])
    expect(sanitizeQueryList(undefined)).toEqual([])
  })
})
