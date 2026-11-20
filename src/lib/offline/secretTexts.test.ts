import { beforeEach, describe, expect, test, vi } from 'vitest'

// シークレット内検索の暗号文の控え (docs/130-シークレット内検索計画.md §5-2)。
// IndexedDB の配管 (idb.ts) だけを差し替える
const mocks = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
}))

vi.mock('./idb', () => ({
  getRecord: async (store: string, key: string) => mocks.records.get(`${store}/${key}`),
  putRecord: async (store: string, key: string, value: unknown) => {
    mocks.records.set(`${store}/${key}`, value)
  },
  deleteRecord: async (store: string, key: string) => {
    mocks.records.delete(`${store}/${key}`)
  },
}))

const { clearSecretTextCache, loadSecretTextCache, saveSecretTextCache } = await import(
  './secretTexts'
)

const ROW = { hash: 'abc', data: new Uint8Array([1, 2, 3]) }

beforeEach(() => {
  mocks.records = new Map()
})

describe('控えの読み書き', () => {
  test('保存した物をそのまま読み戻す', async () => {
    await saveSecretTextCache(new Map([['a', ROW]]))

    expect([...(await loadSecretTextCache())]).toEqual([['a', ROW]])
  })

  test('控えが無ければ空', async () => {
    expect((await loadSecretTextCache()).size).toBe(0)
  })

  test('形が違う行だけを落とす (古い版・壊れた値)', async () => {
    mocks.records.set(
      'secretTexts/all',
      new Map<unknown, unknown>([
        ['ok', ROW],
        ['no-hash', { data: new Uint8Array([1]) }],
        ['text-data', { hash: 'x', data: 'plain' }],
        [1, ROW],
        ['null', null],
      ]),
    )

    expect([...(await loadSecretTextCache()).keys()]).toEqual(['ok'])
  })

  test('Map でない値は控えなしとして扱う', async () => {
    mocks.records.set('secretTexts/all', { a: ROW })

    expect((await loadSecretTextCache()).size).toBe(0)
  })

  test('消すと空に戻る', async () => {
    await saveSecretTextCache(new Map([['a', ROW]]))

    await clearSecretTextCache()

    expect((await loadSecretTextCache()).size).toBe(0)
  })
})
