import { beforeEach, describe, expect, test, vi } from 'vitest'

// search_queries 表の代役。demoQuota.test.ts と同じく @/lib/db を差し替えるが、
// ここは並びと差分の書き込みそのものが試験対象なので、行を持つ本物らしい
// 偽物を用意する (findMany の order / deleteMany の in / upsert の複合キー)。
interface Row {
  id: number
  userName: string
  kind: string
  query: string
  usedAt: Date
}

const store = vi.hoisted(() => ({ rows: [] as Row[], nextId: 1, clock: 0 }))

// upsert が既定で入れる used_at。実際の DB は CURRENT_TIMESTAMP だが、
// テストでは呼ばれた順が分かるよう単調増加のカウンタにする
function nextNow(): Date {
  store.clock += 1
  return new Date(store.clock)
}

const fakePrisma = vi.hoisted(() => {
  const searchQuery = {
    findMany: async ({
      where,
      skip,
    }: {
      where: { userName: string; kind?: string }
      skip?: number
    }) =>
      store.rows
        .filter(
          (r) =>
            r.userName === where.userName &&
            (where.kind === undefined || r.kind === where.kind),
        )
        // orderBy: [{ usedAt: 'desc' }, { id: 'desc' }]
        .sort((a, b) => b.usedAt.getTime() - a.usedAt.getTime() || b.id - a.id)
        .slice(skip ?? 0)
        .map((r) => ({ ...r })),

    findFirst: async ({ where }: { where: { userName: string } }) =>
      store.rows
        .filter((r) => r.userName === where.userName)
        .sort((a, b) => b.usedAt.getTime() - a.usedAt.getTime() || b.id - a.id)
        .map((r) => ({ ...r }))[0] ?? null,

    deleteMany: async ({
      where,
    }: {
      where: {
        userName?: string
        kind?: string
        query?: string | { in: string[] }
        id?: { in: number[] }
      }
    }) => {
      const matches = (r: Row) => {
        if (where.id) {
          return where.id.in.includes(r.id)
        }
        if (r.userName !== where.userName || r.kind !== where.kind) {
          return false
        }
        return typeof where.query === 'string'
          ? r.query === where.query
          : (where.query?.in.includes(r.query) ?? false)
      }
      const count = store.rows.filter(matches).length
      store.rows = store.rows.filter((r) => !matches(r))
      return { count }
    },

    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userName_kind_query: { userName: string; kind: string; query: string } }
      create: { userName: string; kind: string; query: string; usedAt?: Date }
      update: { usedAt?: Date }
    }) => {
      const key = where.userName_kind_query
      const found = store.rows.find(
        (r) => r.userName === key.userName && r.kind === key.kind && r.query === key.query,
      )
      if (found) {
        if (update.usedAt) {
          found.usedAt = update.usedAt
        }
        return { ...found }
      }
      const row: Row = {
        id: store.nextId++,
        userName: create.userName,
        kind: create.kind,
        query: create.query,
        usedAt: create.usedAt ?? nextNow(),
      }
      store.rows.push(row)
      return { ...row }
    },
  }
  // $transaction が自分自身を渡すので、型は先に名前を付けておく
  type FakeClient = {
    searchQuery: typeof searchQuery
    $transaction: <T>(fn: (tx: FakeClient) => Promise<T>) => Promise<T>
  }
  const client: FakeClient = {
    searchQuery,
    $transaction: async (fn) => fn(client),
  }
  return client
})

vi.mock('@/lib/db', () => ({ prisma: fakePrisma }))

import {
  importSavedQueries,
  listQueries,
  recordUse,
  registerSaved,
  unregisterSaved,
} from './searchQueryStore'
import { QUERY_LIMIT, SAVED_LIMIT } from './searchQueries'

const USER = 'tommie'
const OTHER = 'someone-else'

beforeEach(() => {
  store.rows = []
  store.nextId = 1
  store.clock = 0
})

// 「使った」を順に流し込む。並びの試験で何度も要る
async function useAll(user: string, queries: string[]): Promise<void> {
  for (const q of queries) {
    await recordUse(user, q)
  }
}

describe('recordUse', () => {
  test('records an unregistered query at the head of the recent list', async () => {
    // Arrange / Act
    await useAll(USER, ['抵抗', 'コンデンサ'])

    // Assert
    expect((await listQueries(USER)).recent).toEqual(['コンデンサ', '抵抗'])
  })

  test('moves a used query to the head instead of duplicating it', async () => {
    await useAll(USER, ['抵抗', 'コンデンサ', '抵抗'])

    expect((await listQueries(USER)).recent).toEqual(['抵抗', 'コンデンサ'])
  })

  test('drops older entries that are a prefix of the new one', async () => {
    // 打ちながら検索するので、記録の契機を絞ってもなお打ちかけが混ざりうる
    await useAll(USER, ['電', '電験'])

    expect((await listQueries(USER)).recent).toEqual(['電験'])
  })

  test('keeps longer entries that extend the new one', async () => {
    // 長い語を覚えている状態で短く検索し直すのは、それ自体が新しい検索
    await useAll(USER, ['電験三種', '電験'])

    expect((await listQueries(USER)).recent).toEqual(['電験', '電験三種'])
  })

  test('caps the recent list at QUERY_LIMIT', async () => {
    await useAll(
      USER,
      Array.from({ length: QUERY_LIMIT + 3 }, (_, i) => `q${i}`),
    )

    const { recent } = await listQueries(USER)
    expect(recent).toHaveLength(QUERY_LIMIT)
    expect(recent[0]).toBe(`q${QUERY_LIMIT + 2}`)
    expect(recent).not.toContain('q0') // あふれた行は表からも消えている
    expect(store.rows.filter((r) => r.kind === 'recent')).toHaveLength(QUERY_LIMIT)
  })

  test('touches a registered pattern instead of adding it to the history', async () => {
    // Arrange
    await useAll(USER, ['抵抗'])
    await registerSaved(USER, 'is:todo')
    await useAll(USER, ['コンデンサ'])

    // Act
    const after = await recordUse(USER, 'is:todo')

    // Assert
    expect(after.saved).toEqual(['is:todo'])
    expect(after.recent).toEqual(['コンデンサ', '抵抗']) // 履歴には入らない
  })

  test('trims to the limit even when the row was never in the read (concurrent write)', async () => {
    // 2 台から同時に記録すると、どちらも同じ 1 行を消して各自 1 行を足し、
    // 11 行目が残る。readLists は上限で切って返すのでその行は以後どの計算にも
    // 現れず、名前の差分で消す方式だと永久に居座る
    await useAll(
      USER,
      Array.from({ length: QUERY_LIMIT }, (_, i) => `q${i}`),
    )
    store.rows.push({
      id: store.nextId++,
      userName: USER,
      kind: 'recent',
      query: '取り残された行',
      usedAt: new Date(0), // いちばん古い = 一覧に出てこない
    })

    await recordUse(USER, 'new')

    expect(store.rows.filter((r) => r.kind === 'recent')).toHaveLength(QUERY_LIMIT)
    expect(store.rows.some((r) => r.query === '取り残された行')).toBe(false)
  })

  test('stamps used_at from one clock so the order cannot invert', async () => {
    // 作るときは DB の既定値・更新は Node の時計、だと時計のずれで
    // 「最近使った順」が入れ替わる
    await useAll(USER, ['抵抗'])

    const created = store.rows[0].usedAt
    expect(created.getTime()).toBeGreaterThan(new Date(0).getTime())
    expect(created.getTime()).toBeLessThanOrEqual(Date.now())
  })

  test('ignores an empty query (the home link searches nothing)', async () => {
    await useAll(USER, ['抵抗'])

    const after = await recordUse(USER, '   ')

    expect(after.recent).toEqual(['抵抗'])
    expect(store.rows).toHaveLength(1)
  })
})

describe('registerSaved / unregisterSaved', () => {
  test('puts a newly registered pattern at the head (= just used)', async () => {
    await registerSaved(USER, '#発注')
    const after = await registerSaved(USER, 'is:todo')

    expect(after?.saved).toEqual(['is:todo', '#発注'])
  })

  test('registering twice does not duplicate or fail', async () => {
    await registerSaved(USER, 'is:todo')
    const after = await registerSaved(USER, 'is:todo')

    expect(after?.saved).toEqual(['is:todo'])
    expect(store.rows.filter((r) => r.kind === 'saved')).toHaveLength(1)
  })

  test('refuses a new pattern once SAVED_LIMIT is reached', async () => {
    for (let i = 0; i < SAVED_LIMIT; i++) {
      await registerSaved(USER, `p${i}`)
    }

    expect(await registerSaved(USER, 'one-too-many')).toBeNull()
    expect(store.rows.filter((r) => r.kind === 'saved')).toHaveLength(SAVED_LIMIT)
  })

  test('still touches an already registered pattern when the list is full', async () => {
    for (let i = 0; i < SAVED_LIMIT; i++) {
      await registerSaved(USER, `p${i}`)
    }

    const after = await registerSaved(USER, 'p0')

    expect(after?.saved[0]).toBe('p0') // 満杯でも先頭へ動く
  })

  test('unregistering puts the pattern back into the history', async () => {
    // 外した行はその場で 🕐 に変わるので、履歴に実体が無いと
    // 「閉じて開いたら消えていた」になる
    await registerSaved(USER, 'is:todo')

    const after = await unregisterSaved(USER, 'is:todo')

    expect(after.saved).toEqual([])
    expect(after.recent).toEqual(['is:todo'])
  })

  test('unregistering something that was never registered still records it', async () => {
    const after = await unregisterSaved(USER, 'is:todo')

    expect(after.saved).toEqual([])
    expect(after.recent).toEqual(['is:todo'])
  })
})

describe('importSavedQueries', () => {
  test('keeps the order the legacy list had', async () => {
    const after = await importSavedQueries(USER, ['a', 'b', 'c'])

    expect(after.saved).toEqual(['a', 'b', 'c'])
    expect((await listQueries(USER)).saved).toEqual(['a', 'b', 'c'])
  })

  test('does not duplicate what the server already has', async () => {
    await registerSaved(USER, 'b')

    const after = await importSavedQueries(USER, ['a', 'b'])

    expect(after.saved.filter((q) => q === 'b')).toHaveLength(1)
    expect(after.saved).toContain('a')
  })

  test('silently drops the overflow instead of failing the whole import', async () => {
    const many = Array.from({ length: SAVED_LIMIT + 5 }, (_, i) => `p${i}`)

    const after = await importSavedQueries(USER, many)

    expect(after.saved).toHaveLength(SAVED_LIMIT)
    expect(after.saved[0]).toBe('p0') // 先頭側が残る
  })

  test('does nothing for an empty list', async () => {
    const after = await importSavedQueries(USER, [])

    expect(after).toEqual({ saved: [], recent: [] })
    expect(store.rows).toHaveLength(0)
  })
})

describe('スコープ (ユーザ毎)', () => {
  test("one user's history never shows up for another", async () => {
    await useAll(USER, ['抵抗'])
    await registerSaved(USER, 'is:todo')

    expect(await listQueries(OTHER)).toEqual({ saved: [], recent: [] })
  })

  test('the same query can be recorded independently for two users', async () => {
    await useAll(USER, ['抵抗'])
    await useAll(OTHER, ['抵抗'])

    expect((await listQueries(USER)).recent).toEqual(['抵抗'])
    expect((await listQueries(OTHER)).recent).toEqual(['抵抗'])
    expect(store.rows).toHaveLength(2)
  })

  test("trimming to the limit does not touch another user's rows", async () => {
    await useAll(OTHER, ['大事な検索'])
    await useAll(
      USER,
      Array.from({ length: QUERY_LIMIT + 3 }, (_, i) => `q${i}`),
    )

    expect((await listQueries(OTHER)).recent).toEqual(['大事な検索'])
  })

  test("unregistering does not remove another user's pattern of the same name", async () => {
    await registerSaved(USER, 'is:todo')
    await registerSaved(OTHER, 'is:todo')

    await unregisterSaved(USER, 'is:todo')

    expect((await listQueries(OTHER)).saved).toEqual(['is:todo'])
  })
})
