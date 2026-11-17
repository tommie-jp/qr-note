import { describe, expect, test } from 'vitest'
import { createResourceCache } from './resourceCache'

// 古い値を見せながら取り直す入れ物 (docs/123 §3-2)。相乗り・古い印・遅れて
// 届いた応答の捨て方・上限を固定する。フック (useEntry) は画面側の E2E で見る

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function cacheWith(responses: Array<ReturnType<typeof deferred<string>>>) {
  const calls: string[] = []
  const cache = createResourceCache<string, string>({
    fetch: (key) => {
      calls.push(key)
      const next = responses.shift()
      if (next === undefined) {
        throw new Error('想定より多く取りに行った')
      }
      return next.promise
    },
    maxEntries: 3,
  })
  return { cache, calls }
}

describe('createResourceCache', () => {
  test('同じ鍵の取得が進行中なら相乗りし、二重に撃たない', async () => {
    // Arrange
    const first = deferred<string>()
    const { cache, calls } = cacheWith([first])

    // Act
    const a = cache.load('k')
    const b = cache.load('k')
    first.resolve('v1')

    // Assert
    await expect(a).resolves.toBe('v1')
    await expect(b).resolves.toBe('v1')
    expect(calls).toEqual(['k'])
    expect(cache.peek('k')).toMatchObject({ value: 'v1', stale: false, loading: false })
  })

  test('新しい値があれば取りに行かない', async () => {
    // Arrange
    const first = deferred<string>()
    const { cache, calls } = cacheWith([first])
    first.resolve('v1')
    await cache.load('k')

    // Act
    const again = await cache.load('k')

    // Assert
    expect(again).toBe('v1')
    expect(calls).toEqual(['k'])
  })

  test('古い印を付けても値は残り、取り直しの間も前の値を返す', async () => {
    // Arrange
    const first = deferred<string>()
    const second = deferred<string>()
    const { cache } = cacheWith([first, second])
    first.resolve('v1')
    await cache.load('k')

    // Act
    cache.invalidate()
    const reload = cache.load('k')

    // Assert
    expect(cache.peek('k')).toMatchObject({ value: 'v1', stale: true, loading: true })
    second.resolve('v2')
    await expect(reload).resolves.toBe('v2')
    expect(cache.peek('k')).toMatchObject({ value: 'v2', stale: false })
  })

  test('取り直しの途中で set されたら、遅れて届いた古い応答で上書きしない', async () => {
    // Arrange
    const slow = deferred<string>()
    const { cache } = cacheWith([slow])
    const pending = cache.load('k')

    // Act
    cache.set('k', '書いた後の値')
    slow.resolve('古い応答')
    await pending

    // Assert
    expect(cache.peek('k')?.value).toBe('書いた後の値')
  })

  test('失敗しても前の値は捨てず、error に入れる', async () => {
    // Arrange
    const first = deferred<string>()
    const second = deferred<string>()
    const { cache } = cacheWith([first, second])
    first.resolve('v1')
    await cache.load('k')
    cache.invalidate()

    // Act
    const reload = cache.load('k')
    second.reject(new Error('圏外'))

    // Assert
    await expect(reload).rejects.toThrow('圏外')
    expect(cache.peek('k')).toMatchObject({ value: 'v1', loading: false })
    expect(cache.peek('k')?.error?.message).toBe('圏外')
  })

  test('invalidate は鍵を選べる', async () => {
    // Arrange
    const { cache } = cacheWith([])
    cache.set('a', '1')
    cache.set('b', '2')

    // Act
    cache.invalidate((key) => key === 'a')

    // Assert
    expect(cache.peek('a')?.stale).toBe(true)
    expect(cache.peek('b')?.stale).toBe(false)
  })

  test('update は値があるときだけ作り直す', () => {
    // Arrange
    const { cache } = cacheWith([])
    cache.set('a', 'x')

    // Act
    cache.update('a', (v) => `${v}y`)
    cache.update('missing', (v) => `${v}z`)

    // Assert
    expect(cache.peek('a')?.value).toBe('xy')
    expect(cache.peek('missing')).toBeUndefined()
  })

  test('remove は鍵ごと捨て、上限を超えたら古い順に捨てる', () => {
    // Arrange
    const { cache } = cacheWith([])

    // Act
    for (const key of ['a', 'b', 'c', 'd']) {
      cache.set(key, key)
    }
    cache.remove((key) => key === 'c')

    // Assert
    expect(cache.keys()).toEqual(['b', 'd'])
  })

  test('使っている最中の鍵は、上限を超えても捨てない', () => {
    // Arrange: 画面に出ている部品が a・b・c を使っている (上限は 3)
    const { cache } = cacheWith([])
    for (const key of ['a', 'b', 'c']) {
      cache.set(key, key)
      cache.hold(key)
    }

    // Act: 4 つ目の部品が d を入れる
    cache.set('d', 'd')

    // Assert: 捨てると a の部品が取り直し、それが b を捨て…と終わらなくなる
    expect(cache.keys()).toEqual(['a', 'b', 'c', 'd'])
  })

  test('使っていない鍵があれば、使っている鍵を飛ばして古い順に捨てる', () => {
    // Arrange
    const { cache } = cacheWith([])
    cache.set('a', 'a')
    cache.hold('a')
    cache.set('b', 'b')
    cache.set('c', 'c')

    // Act
    cache.set('d', 'd')

    // Assert
    expect(cache.keys()).toEqual(['a', 'c', 'd'])
  })

  test('使い終えた鍵は、次に上限を超えたとき捨てる', () => {
    // Arrange
    const { cache } = cacheWith([])
    const release = cache.hold('a')
    for (const key of ['a', 'b', 'c']) {
      cache.set(key, key)
    }

    // Act: 同じ鍵を 2 つの部品が使い、片方だけが終えた間は残る
    const releaseOther = cache.hold('a')
    release()
    cache.set('d', 'd')
    const whileHeld = cache.keys()
    releaseOther()
    cache.set('e', 'e')

    // Assert
    expect(whileHeld).toEqual(['a', 'c', 'd'])
    expect(cache.keys()).toEqual(['c', 'd', 'e'])
  })

  test('書き換えのたびに購読者へ知らせ、項目は作り直す (同一性で変化を見る)', () => {
    // Arrange
    const { cache } = cacheWith([])
    let notified = 0
    const unsubscribe = cache.subscribe(() => {
      notified += 1
    })
    cache.set('a', '1')
    const before = cache.peek('a')

    // Act
    cache.invalidate()
    unsubscribe()
    cache.set('a', '2')

    // Assert
    expect(notified).toBe(2)
    expect(cache.peek('a')).not.toBe(before)
  })

  test('古い印は失敗の記録も消す (撃ち直してよい合図)', async () => {
    // Arrange
    const first = deferred<string>()
    const { cache } = cacheWith([first])
    const pending = cache.load('k')
    first.reject(new Error('圏外'))
    await pending.catch(() => {})

    // Act
    cache.invalidate()

    // Assert
    expect(cache.peek('k')).toMatchObject({ error: null, stale: true })
  })

  test('値が届いた時刻を持つ', async () => {
    // Arrange
    let clock = 1000
    const cache = createResourceCache<string, string>({
      fetch: async () => 'v',
      now: () => clock,
    })

    // Act
    await cache.load('k')
    clock = 5000
    cache.set('j', 'w')

    // Assert
    expect(cache.peek('k')?.at).toBe(1000)
    expect(cache.peek('j')?.at).toBe(5000)
  })
})

describe('seed (端末に残した控え。docs/129 §3)', () => {
  test('値の無い鍵にだけ入れ、進行中の取得の応答は捨てない', async () => {
    // Arrange
    let resolve: (value: string) => void = () => {}
    const cache = createResourceCache<string, string>({
      fetch: () => new Promise<string>((r) => (resolve = r)),
    })
    const loading = cache.load('a')

    // Act
    cache.seed('a', '残した値', 0)
    const seeded = cache.peek('a')
    resolve('届いた値')
    await loading

    // Assert
    expect(seeded).toMatchObject({ value: '残した値', loading: true, at: 0 })
    expect(cache.peek('a')?.value).toBe('届いた値')
  })

  test('もう値があれば入れない', () => {
    // Arrange
    const cache = createResourceCache<string, string>({ fetch: async () => 'x' })
    cache.set('a', '新しい値')

    // Act
    cache.seed('a', '残した値', 0)

    // Assert
    expect(cache.peek('a')?.value).toBe('新しい値')
  })
})
