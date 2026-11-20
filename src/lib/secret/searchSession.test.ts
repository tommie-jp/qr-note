import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { secretContext } from './content'
import { importContentKey, sealSecret } from './envelope'
import { SECRET_TEXT_MIME } from './payload'
import { SecretCancelledError } from './prf'
import type { Item } from '@/generated/prisma/client'
import type { CachedSecretText, SecretTextEntry } from './search'
import { isUnlocked, lockSecrets, SECRET_IDLE_LOCK_MS, unlockWith } from './session'

// シークレット内検索の状態 (docs/130-シークレット内検索計画.md §3-1, §5)。
//
// 差し替えるのは口 (searchApi)・端末の控え (offline/secretTexts)・認証器を呼ぶ
// 解錠 (unlock) の 3 つだけ。鍵の置き場 (session)・暗号 (envelope) は本物を使い、
// **本物の鍵で封をした暗号文が、照合できる平文になるところまで**を確かめる
const mocks = vi.hoisted(() => ({
  entries: [] as SecretTextEntry[],
  items: [] as Item[],
  indexFetches: 0,
  server: new Map<string, Uint8Array>(),
  cache: new Map<string, CachedSecretText>(),
  fetchedNames: [] as string[][],
  savedCaches: [] as Map<string, CachedSecretText>[],
  indexError: null as Error | null,
  // n 回目のまとめ取りで落とす (0 = 落とさない)
  failFetchAt: 0,
  onFetch: null as (() => void) | null,
  unlockWithPasskey: vi.fn<() => Promise<void>>(),
}))

vi.mock('./searchApi', () => ({
  fetchSecretTextIndex: async () => {
    mocks.indexFetches += 1
    if (mocks.indexError) {
      throw mocks.indexError
    }
    return { entries: mocks.entries, items: mocks.items }
  },
  fetchSecretTextBlobs: async (names: string[]) => {
    mocks.fetchedNames.push(names)
    if (mocks.fetchedNames.length === mocks.failFetchAt) {
      throw new Error('通信に失敗しました')
    }
    mocks.onFetch?.()
    return new Map(names.flatMap((name) => {
      const data = mocks.server.get(name)
      return data === undefined ? [] : [[name, data] as const]
    }))
  },
}))

vi.mock('../offline/secretTexts', () => ({
  loadSecretTextCache: async () => new Map(mocks.cache),
  saveSecretTextCache: async (cache: Map<string, CachedSecretText>) => {
    mocks.savedCaches.push(new Map(cache))
  },
}))

vi.mock('./unlock', () => ({ unlockWithPasskey: mocks.unlockWithPasskey }))

const { disableSecretSearch, enableSecretSearch, noteSecretSearchUse, secretSearchState } =
  await import('./searchSession')
const {
  isSecretSearchedQuery,
  isSecretSearchOn,
  markSecretSearchedQuery,
  requestSecretSearchReload,
  subscribeSecretSearchedQueries,
} = await import('./searchPrivacy')

const RAW = new Uint8Array(32).fill(7)
const A = '0421547b-ee29-4613-a6d4-da0f41f94054'
const B = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'

async function seal(name: string, text: string, raw = RAW): Promise<Uint8Array> {
  const key = await importContentKey(raw)
  return sealSecret(key, new TextEncoder().encode(text), secretContext(name, SECRET_TEXT_MIME))
}

function entry(name: string, data: Uint8Array, hash = `hash-${name}`): SecretTextEntry {
  return {
    name,
    hash,
    bytes: data.byteLength,
    refs: [{ itemId: `item-${name}`, title: '題名', label: 'ラベル' }],
  }
}

async function addSecret(name: string, text: string, raw = RAW): Promise<Uint8Array> {
  const data = await seal(name, text, raw)
  mocks.server.set(name, data)
  mocks.entries.push(entry(name, data))
  return data
}

const state = () => secretSearchState()

beforeEach(() => {
  mocks.entries = []
  mocks.items = []
  mocks.indexFetches = 0
  mocks.server = new Map()
  mocks.cache = new Map()
  mocks.fetchedNames = []
  mocks.savedCaches = []
  mocks.indexError = null
  mocks.failFetchAt = 0
  mocks.onFetch = null
  mocks.unlockWithPasskey.mockReset()
  mocks.unlockWithPasskey.mockImplementation(() => unlockWith(RAW))
})

afterEach(() => {
  disableSecretSearch()
  lockSecrets()
  vi.restoreAllMocks()
})

describe('enableSecretSearch', () => {
  test('解錠済みなら認証器を呼ばず、復号して照合できる形で持つ', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'ＡＢＣ銀行 口座 1234567')

    await enableSecretSearch()

    const current = state()
    expect(current.status).toBe('on')
    if (current.status !== 'on') return
    expect(mocks.unlockWithPasskey).not.toHaveBeenCalled()
    expect([...current.index.haystacks]).toEqual([[A, 'abc銀行 口座 1234567']])
    expect(current.index.entries.map((e) => e.name)).toEqual([A])
    expect(current.index).toMatchObject({ skipped: 0, failed: 0 })
    expect(isSecretSearchOn()).toBe(true)
  })

  test('未解錠なら解錠から始める', async () => {
    await addSecret(A, 'wifi password')

    await enableSecretSearch()

    expect(mocks.unlockWithPasskey).toHaveBeenCalledTimes(1)
    expect(state().status).toBe('on')
  })

  test('解錠を取り消したら、理由を出さずに切れたまま', async () => {
    mocks.unlockWithPasskey.mockRejectedValue(new SecretCancelledError())

    await enableSecretSearch()

    expect(state()).toEqual({ status: 'off', error: null, lockedOut: false })
    expect(isSecretSearchOn()).toBe(false)
  })

  test('失敗したら理由を持って切れたまま', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await unlockWith(RAW)
    mocks.indexError = new Error('通信に失敗しました')

    await enableSecretSearch()

    expect(state()).toEqual({ status: 'off', error: '通信に失敗しました', lockedOut: false })
  })

  test('控えとハッシュが同じ断片は取り直さず、変わった分だけ取って控えを差し替える', async () => {
    await unlockWith(RAW)
    const dataA = await addSecret(A, 'alpha')
    const dataB = await addSecret(B, 'bravo')
    mocks.cache.set(A, { hash: `hash-${A}`, data: dataA })
    mocks.cache.set(B, { hash: 'old', data: new Uint8Array([1]) })
    mocks.cache.set('gone', { hash: 'x', data: new Uint8Array([2]) })

    await enableSecretSearch()

    expect(mocks.fetchedNames).toEqual([[B]])
    expect(mocks.savedCaches).toEqual([
      new Map([
        [A, { hash: `hash-${A}`, data: dataA }],
        [B, { hash: `hash-${B}`, data: dataB }],
      ]),
    ])
    const current = state()
    expect(current.status === 'on' && [...current.index.haystacks.keys()]).toEqual([A, B])
  })

  test('控えに平文は入らない (入るのはサーバと同じ暗号文だけ)', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'TOP-SECRET-PLAINTEXT')

    await enableSecretSearch()

    const saved = new TextDecoder().decode(mocks.savedCaches[0].get(A)?.data)
    expect(saved).not.toContain('TOP-SECRET-PLAINTEXT')
  })

  test('開けない断片・返ってこない断片は数えて、残りは探せる', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await unlockWith(RAW)
    await addSecret(A, 'ok')
    await addSecret(B, 'other key', new Uint8Array(32).fill(9))
    const missing = '9c5b94b1-35ad-49bb-b118-8e8fc24abf80'
    mocks.entries.push(entry(missing, new Uint8Array(40)))

    await enableSecretSearch()

    const current = state()
    expect(current.status).toBe('on')
    if (current.status !== 'on') return
    expect([...current.index.haystacks.keys()]).toEqual([A])
    expect(current.index.entries.map((e) => e.name)).toEqual([A])
    expect(current.index.failed).toBe(2)
  })
})

describe('平文を捨てる時', () => {
  test('トグルを切ると平文を捨てる (施錠はしない)', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    await enableSecretSearch()

    disableSecretSearch()

    expect(state()).toEqual({ status: 'off', error: null, lockedOut: false })
    expect(isUnlocked()).toBe(true)
  })

  test('施錠されたら切れて平文を捨てる', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    await enableSecretSearch()

    lockSecrets()

    // 入っていたのに切れた、を節が言えるように印を残す
    expect(state()).toEqual({ status: 'off', error: null, lockedOut: true })
    expect(isSecretSearchOn()).toBe(false)
  })

  test('施錠で切れた印は、入れ直す・切るで消える', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    await enableSecretSearch()
    lockSecrets()

    disableSecretSearch()

    expect(state()).toEqual({ status: 'off', error: null, lockedOut: false })
  })

  test('読み込みの途中で切ったら、遅れて届いた平文を持たない', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')

    const pending = enableSecretSearch()
    expect(state().status).toBe('loading')
    expect(isSecretSearchOn()).toBe(true)
    disableSecretSearch()
    await pending

    expect(state()).toEqual({ status: 'off', error: null, lockedOut: false })
  })

  test('読み込みの途中で施錠されたら入らない', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')

    const pending = enableSecretSearch()
    lockSecrets()
    await pending

    expect(state().status).toBe('off')
  })
})

describe('トグルが入っている間に探した語 (端末の控えに残さない印)', () => {
  test('切れている間の語には印を付けない', () => {
    markSecretSearchedQuery('抵抗 1608')

    expect(isSecretSearchedQuery('抵抗 1608')).toBe(false)
  })

  test('入っている間の語に印を付け、増えたときだけ知らせる', async () => {
    await unlockWith(RAW)
    await enableSecretSearch()
    const listener = vi.fn()
    const unsubscribe = subscribeSecretSearchedQueries(listener)

    markSecretSearchedQuery(' 1234567 ')
    markSecretSearchedQuery('1234567')
    markSecretSearchedQuery('   ')

    expect(isSecretSearchedQuery('1234567')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  test('トグルを切った後も印は残る (切った直後に控えへ書かれないように)', async () => {
    await unlockWith(RAW)
    await enableSecretSearch()
    markSecretSearchedQuery('口座番号')

    disableSecretSearch()

    expect(isSecretSearchedQuery('口座番号')).toBe(true)
  })
})

describe('途中で止まったとき', () => {
  test('束の途中で通信が切れても、取れた分は控えに残す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await unlockWith(RAW)
    const dataA = await addSecret(A, 'alpha')
    await addSecret(B, 'bravo')
    // 1 件ずつの束にする (2 束目で落とす)
    mocks.entries = mocks.entries.map((e) => ({ ...e, bytes: 4 * 1024 * 1024 }))
    mocks.failFetchAt = 2

    await enableSecretSearch()

    expect(state().status).toBe('off')
    expect(mocks.savedCaches).toEqual([new Map([[A, { hash: `hash-${A}`, data: dataA }]])])
  })

  test('取得の途中で切られたら、残りの束を取りに行かない', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    await addSecret(B, 'bravo')
    mocks.entries = mocks.entries.map((e) => ({ ...e, bytes: 4 * 1024 * 1024 }))
    mocks.onFetch = () => disableSecretSearch()

    await enableSecretSearch()

    expect(mocks.fetchedNames).toEqual([[A]])
    expect(state()).toEqual({ status: 'off', error: null, lockedOut: false })
  })
})

describe('自動施錠 (無操作 5 分) と検索', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('探し続けている間は施錠されない', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    await enableSecretSearch()
    vi.useFakeTimers()
    // 入れた時点の数え直し (本物のタイマー) は偽の時計では進まないので、掛け直す
    noteSecretSearchUse()

    // 4 分ごとに検索語を打つ (合計 12 分)
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(4 * 60 * 1000)
      noteSecretSearchUse()
    }

    expect(isUnlocked()).toBe(true)
    expect(state().status).toBe('on')
  })

  test('手を止めて 5 分で施錠され、切れた理由が残る', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    await enableSecretSearch()
    vi.useFakeTimers()
    noteSecretSearchUse()

    vi.advanceTimersByTime(SECRET_IDLE_LOCK_MS + 1)

    expect(isUnlocked()).toBe(false)
    expect(state()).toEqual({ status: 'off', error: null, lockedOut: true })
  })

  test('切れている間の印は施錠を延ばさない (鍵を使っていないのに延命しない)', async () => {
    vi.useFakeTimers()
    await unlockWith(RAW)

    vi.advanceTimersByTime(4 * 60 * 1000)
    noteSecretSearchUse()
    vi.advanceTimersByTime(2 * 60 * 1000)

    expect(isUnlocked()).toBe(false)
  })
})

function note(itemId: string, memo: string): Item {
  const at = new Date('2026-10-01T00:00:00.000Z')
  return {
    itemId,
    memo,
    title: itemId,
    tags: [],
    props: [],
    taskTodo: 0,
    taskDone: 0,
    createdAt: at,
    updatedAt: at,
    accessedAt: at,
    deletedAt: null,
    publicAt: null,
    offlinePin: false,
    eventStart: null,
    eventEnd: null,
    eventRepeat: null,
  }
}

describe('一覧の行として描く材料 (docs/131)', () => {
  test('シークレットを含むノートを、検索語に関係なく全部持つ', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    mocks.items = [note('n1', '本文'), note('n2', '別のノート')]

    await enableSecretSearch()

    const current = state()
    expect(current.status).toBe('on')
    if (current.status !== 'on') return
    expect([...current.index.notes.keys()]).toEqual(['n1', 'n2'])
  })

})

describe('書き込みの後の取り直し (docs/131 §6)', () => {
  test('入っている間に合図が来たら、材料を取り直して差し替える', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    mocks.items = [note('n1', 'x')]
    await enableSecretSearch()

    // ノート n1 がゴミ箱へ行き、断片 B が足された
    mocks.items = []
    await addSecret(B, 'bravo')
    requestSecretSearchReload()
    await vi.waitFor(() => expect(mocks.indexFetches).toBe(2))
    await vi.waitFor(() => {
      const current = state()
      expect(current.status === 'on' && [...current.index.haystacks.keys()]).toEqual([A, B])
    })

    const current = state()
    expect(current.status === 'on' && current.index.notes.size).toBe(0)
  })

  test('読み込みの最中に合図が来たら、入った直後に 1 度取り直す', async () => {
    await unlockWith(RAW)
    await addSecret(A, 'alpha')

    const pending = enableSecretSearch()
    requestSecretSearchReload()
    await pending

    await vi.waitFor(() => expect(mocks.indexFetches).toBe(2))
    expect(state().status).toBe('on')
  })

  test('切れている間の合図では取りに行かない', async () => {
    requestSecretSearchReload()
    await Promise.resolve()

    expect(mocks.indexFetches).toBe(0)
  })

  test('取り直しに失敗しても切らず、前の材料のまま探せる', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await unlockWith(RAW)
    await addSecret(A, 'alpha')
    await enableSecretSearch()

    mocks.indexError = new Error('通信に失敗しました')
    requestSecretSearchReload()
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())

    const current = state()
    expect(current.status === 'on' && [...current.index.haystacks.keys()]).toEqual([A])
  })
})
