import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { QueryLists } from './searchQueries'

// 引き取りの口だけを差し替える。localStorage を消してよいかの判断が
// 試験対象なので、送れた / 送れなかったをこちらから決める
const mocks = vi.hoisted(() => ({
  sent: [] as string[][],
  answer: { saved: [], recent: [] } as QueryLists | null,
}))

vi.mock('./searchQueryClient', () => ({
  importSavedQueries: async (saved: string[]) => {
    mocks.sent.push(saved)
    return mocks.answer
  },
}))

import { migrateLegacyQueries } from './searchQueryLegacy'

const SAVED_KEY = 'qr-search-saved'
const RECENT_KEY = 'qr-search-recent'

// vitest の環境は node なので localStorage は無い。必要な分だけ生やす
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
    keys: () => Object.keys(data),
  }
}

function install(storage: ReturnType<typeof fakeStorage>): void {
  vi.stubGlobal('window', { localStorage: storage })
}

beforeEach(() => {
  mocks.sent = []
  mocks.answer = { saved: [], recent: [] }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('migrateLegacyQueries', () => {
  test('sends the registered patterns and then clears both keys', async () => {
    // Arrange
    const storage = fakeStorage({
      [SAVED_KEY]: JSON.stringify(['is:todo', '#発注']),
      [RECENT_KEY]: JSON.stringify(['抵抗']),
    })
    install(storage)
    mocks.answer = { saved: ['is:todo', '#発注'], recent: [] }

    // Act
    const lists = await migrateLegacyQueries(false)

    // Assert
    expect(mocks.sent).toEqual([['is:todo', '#発注']])
    expect(lists).toEqual({ saved: ['is:todo', '#発注'], recent: [] })
    expect(storage.keys()).toEqual([]) // 二度と送らない
  })

  test('throws away the history without sending it (it fills back up)', async () => {
    const storage = fakeStorage({ [RECENT_KEY]: JSON.stringify(['抵抗', 'コンデンサ']) })
    install(storage)

    await migrateLegacyQueries(false)

    expect(mocks.sent).toEqual([[]])
    expect(storage.keys()).toEqual([])
  })

  test('does nothing at all when there is no leftover', async () => {
    const storage = fakeStorage()
    install(storage)

    expect(await migrateLegacyQueries(false)).toBeNull()
    expect(mocks.sent).toEqual([])
  })

  test('keeps the keys when the server could not be reached', async () => {
    // 消してから失敗すると、登録したパターンがどこにも無くなる
    const storage = fakeStorage({ [SAVED_KEY]: JSON.stringify(['is:todo']) })
    install(storage)
    mocks.answer = null

    expect(await migrateLegacyQueries(false)).toBeNull()
    expect(storage.getItem(SAVED_KEY)).not.toBeNull()
  })

  // デモは履歴を持たない (docs/38-デモモード計画.md)。持たない相手には
  // **そもそも送らない** — 送っても永久に受け取られず、検索窓を開くたびに
  // 送り直す無限ループになる
  test('sends nothing on a demo instance (it would never be accepted)', async () => {
    const storage = fakeStorage({ [SAVED_KEY]: JSON.stringify(['is:todo']) })
    install(storage)

    expect(await migrateLegacyQueries(true)).toBeNull()
    expect(mocks.sent).toEqual([])
    // 消さない。デモを離れて本番で開いたときに引き取れる物を残しておく
    expect(storage.getItem(SAVED_KEY)).not.toBeNull()
  })

  test('clears the keys when only some patterns fit (the overflow was meant to drop)', async () => {
    const storage = fakeStorage({ [SAVED_KEY]: JSON.stringify(['a', 'b']) })
    install(storage)
    mocks.answer = { saved: ['a'], recent: [] }

    expect(await migrateLegacyQueries(false)).not.toBeNull()
    expect(storage.keys()).toEqual([])
  })

  test('clears a corrupted list instead of retrying it forever', async () => {
    const storage = fakeStorage({ [SAVED_KEY]: '{' })
    install(storage)

    await migrateLegacyQueries(false)

    expect(mocks.sent).toEqual([[]])
    expect(storage.keys()).toEqual([])
  })

  test('drops hand-edited entries that cannot be recorded', async () => {
    const storage = fakeStorage({ [SAVED_KEY]: JSON.stringify(['is:todo', '', 42]) })
    install(storage)

    await migrateLegacyQueries(false)

    expect(mocks.sent).toEqual([['is:todo']])
  })

  test('does nothing on the server render', async () => {
    vi.stubGlobal('window', undefined)

    expect(await migrateLegacyQueries(false)).toBeNull()
    expect(mocks.sent).toEqual([])
  })

  // localStorage は塞ぎ方が 2 通りあり、どちらも別の壊れ方をする。
  // **投げると誰も拾えない** — 呼び出し元 (SearchForm) は `void migrate…()` で
  // 撃つだけなので unhandled rejection になり、しかも検索窓を開くたびに出る。

  // Firefox の dom.storage.enabled=false。例外を出さずに undefined になるので、
  // 参照を try で囲っただけでは素通りし、getItem を呼んだ瞬間に落ちる
  test('survives a browser where localStorage is undefined', async () => {
    vi.stubGlobal('window', { localStorage: undefined })

    await expect(migrateLegacyQueries(false)).resolves.toBeNull()
    expect(mocks.sent).toEqual([])
  })

  // Safari / 一部のプライベートモードは getItem 側が SecurityError を投げる
  test('survives a browser where getItem throws', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
        removeItem: () => {},
      },
    })

    await expect(migrateLegacyQueries(false)).resolves.toBeNull()
    expect(mocks.sent).toEqual([])
  })
})
