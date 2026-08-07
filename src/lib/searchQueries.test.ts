import { describe, expect, test } from 'vitest'
import {
  addRecentQuery,
  addSavedQuery,
  browserQueryStorage,
  isSavedFull,
  loadQueries,
  readQueries,
  recordRecentQuery,
  QUERY_LIMIT,
  RECENT_KEY,
  removeSavedQuery,
  SAVED_KEY,
  SAVED_LIMIT,
  saveQueries,
  splitSuggestions,
  SUGGEST_COUNT,
  type QueryStorage,
} from './searchQueries'

// localStorage の代役。vitest の環境は node なので本物は無い
// (drawPrefs.test.ts と同じ書き方)。
function fakeStorage(initial: Record<string, string> = {}): QueryStorage {
  const data = { ...initial }
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

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

describe('addSavedQuery / removeSavedQuery', () => {
  test('appends to the end so registered patterns keep their order', () => {
    // 最近の検索と違い、パターンは並びが動かないから筋肉記憶が効く
    const next = addSavedQuery(['#英単語 is:todo'], 'is:done')

    expect(next).toEqual(['#英単語 is:todo', 'is:done'])
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

describe('readQueries', () => {
  test('returns an empty list when nothing has been saved (safe to write)', () => {
    expect(readQueries(fakeStorage(), SAVED_KEY)).toEqual([])
  })

  test('returns null on broken JSON so a write cannot clobber it', () => {
    expect(readQueries(fakeStorage({ [SAVED_KEY]: '{' }), SAVED_KEY)).toBeNull()
  })

  test('returns null when the stored value is not an array', () => {
    expect(readQueries(fakeStorage({ [SAVED_KEY]: '"a"' }), SAVED_KEY)).toBeNull()
  })

  test('returns null when storage is unavailable', () => {
    expect(readQueries(null, SAVED_KEY)).toBeNull()
  })
})

describe('loadQueries', () => {
  test('reads a saved list back', () => {
    const storage = fakeStorage({ [RECENT_KEY]: JSON.stringify(['抵抗', 'is:todo']) })

    expect(loadQueries(storage, RECENT_KEY)).toEqual(['抵抗', 'is:todo'])
  })

  test('returns an empty list when nothing has been saved', () => {
    expect(loadQueries(fakeStorage(), RECENT_KEY)).toEqual([])
  })

  test('returns an empty list when storage is unavailable', () => {
    expect(loadQueries(null, RECENT_KEY)).toEqual([])
  })

  test('returns an empty list on broken JSON', () => {
    expect(loadQueries(fakeStorage({ [RECENT_KEY]: '{' }), RECENT_KEY)).toEqual([])
  })

  test('drops non-string and empty entries (hand-edited storage)', () => {
    const storage = fakeStorage({ [SAVED_KEY]: JSON.stringify(['a', 3, null, '', 'b']) })

    expect(loadQueries(storage, SAVED_KEY)).toEqual(['a', 'b'])
  })

  test('returns an empty list when the stored value is not an array', () => {
    expect(loadQueries(fakeStorage({ [SAVED_KEY]: '"a"' }), SAVED_KEY)).toEqual([])
  })

  test('caps what it reads back', () => {
    const stored = Array.from({ length: QUERY_LIMIT + 10 }, (_, i) => `q${i}`)
    const storage = fakeStorage({ [RECENT_KEY]: JSON.stringify(stored) })

    expect(loadQueries(storage, RECENT_KEY)).toHaveLength(QUERY_LIMIT)
  })
})

describe('recordRecentQuery', () => {
  test('records the query at the head of the recent list', () => {
    // Arrange
    const storage = fakeStorage({ [RECENT_KEY]: JSON.stringify(['抵抗']) })

    // Act
    recordRecentQuery('is:todo', storage)

    // Assert
    expect(loadQueries(storage, RECENT_KEY)).toEqual(['is:todo', '抵抗'])
  })

  test('ignores an empty query (the home link searches nothing)', () => {
    const storage = fakeStorage({ [RECENT_KEY]: JSON.stringify(['抵抗']) })

    recordRecentQuery('  ', storage)

    expect(loadQueries(storage, RECENT_KEY)).toEqual(['抵抗'])
  })

  test('does nothing when storage is unavailable', () => {
    expect(() => recordRecentQuery('抵抗', null)).not.toThrow()
  })

  test('leaves an unreadable list alone instead of overwriting it', () => {
    // Arrange … 壊れた値を [] と読んで書き戻すと、覚えていた分が全部消える
    const storage = fakeStorage({ [RECENT_KEY]: '{' })

    // Act
    recordRecentQuery('抵抗', storage)

    // Assert
    expect(storage.getItem(RECENT_KEY)).toBe('{')
  })
})

describe('browserQueryStorage', () => {
  test('returns null off the browser (server render)', () => {
    expect(browserQueryStorage()).toBeNull()
  })
})

describe('saveQueries', () => {
  test('round-trips through storage', () => {
    // Arrange
    const storage = fakeStorage()

    // Act
    saveQueries(storage, RECENT_KEY, ['抵抗'])

    // Assert
    expect(loadQueries(storage, RECENT_KEY)).toEqual(['抵抗'])
  })

  test('survives a storage that refuses to write (private mode / quota)', () => {
    const storage: QueryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }

    expect(() => saveQueries(storage, RECENT_KEY, ['抵抗'])).not.toThrow()
  })

  test('does nothing when storage is unavailable', () => {
    expect(() => saveQueries(null, RECENT_KEY, ['抵抗'])).not.toThrow()
  })
})
