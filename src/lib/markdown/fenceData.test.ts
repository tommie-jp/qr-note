import { beforeEach, describe, expect, test, vi } from 'vitest'

const requireUser = vi.fn<() => Promise<string>>()
vi.mock('@/lib/session', () => ({
  requireUser: () => requireUser(),
}))

const { buildFenceData, sharePending } = await import('./fenceData')

type Result = { kind: 'ok'; value: string } | { kind: 'error'; error: string }

beforeEach(() => {
  requireUser.mockReset()
  requireUser.mockResolvedValue('tommie')
})

describe('buildFenceData', () => {
  test('フェンスが無ければ認証も集計もせず空のマップを返す', async () => {
    // Arrange
    const prepare = vi.fn()

    // Act
    const results = await buildFenceData<Result>({
      sources: [],
      limit: 3,
      overLimitError: '多すぎます',
      prepare,
    })

    // Assert
    expect(results.size).toBe(0)
    expect(requireUser).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  test('認証に失敗したら畳まずに投げ、集計しない', async () => {
    // Arrange
    requireUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    const prepare = vi.fn()

    // Act
    const built = buildFenceData<Result>({
      sources: ['a'],
      limit: 3,
      overLimitError: '多すぎます',
      prepare,
    })

    // Assert
    await expect(built).rejects.toThrow('NEXT_REDIRECT')
    expect(prepare).not.toHaveBeenCalled()
  })

  test('フェンスごとに集計し、中身を鍵にしたマップにする', async () => {
    // Arrange
    const build = vi.fn(
      async (source: string): Promise<Result> => ({ kind: 'ok', value: source.toUpperCase() }),
    )
    const prepare = vi.fn(() => build)

    // Act
    const results = await buildFenceData<Result>({
      sources: ['a', 'b'],
      limit: 3,
      overLimitError: '多すぎます',
      prepare,
    })

    // Assert
    expect([...results]).toEqual([
      ['a', { kind: 'ok', value: 'A' }],
      ['b', { kind: 'ok', value: 'B' }],
    ])
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  test('上限を超えたフェンスは後ろから落とし、エラーを先に入れる', async () => {
    // Arrange
    const build = vi.fn(async (source: string): Promise<Result> => ({ kind: 'ok', value: source }))

    // Act
    const results = await buildFenceData<Result>({
      sources: ['a', 'b', 'c', 'd'],
      limit: 2,
      overLimitError: '2 個までです',
      prepare: () => build,
    })

    // Assert
    expect([...results]).toEqual([
      ['c', { kind: 'error', error: '2 個までです' }],
      ['d', { kind: 'error', error: '2 個までです' }],
      ['a', { kind: 'ok', value: 'a' }],
      ['b', { kind: 'ok', value: 'b' }],
    ])
    expect(build.mock.calls.map(([source]) => source)).toEqual(['a', 'b'])
  })

  test('控えは認証の後に作られ、全フェンスで共有される', async () => {
    // Arrange
    const order: string[] = []
    requireUser.mockImplementation(async () => {
      order.push('requireUser')
      return 'tommie'
    })
    const seenCaches = new Set<Map<string, number>>()

    // Act
    await buildFenceData<Result>({
      sources: ['a', 'b'],
      limit: 3,
      overLimitError: '多すぎます',
      prepare: () => {
        order.push('prepare')
        const cache = new Map<string, number>()
        return async (source) => {
          seenCaches.add(cache)
          return { kind: 'ok', value: source }
        }
      },
    })

    // Assert
    expect(order).toEqual(['requireUser', 'prepare'])
    expect(seenCaches.size).toBe(1)
  })

  test('集計が失敗を返したフェンスもそのままマップに入る', async () => {
    const results = await buildFenceData<Result>({
      sources: ['bad', 'good'],
      limit: 3,
      overLimitError: '多すぎます',
      prepare: () => async (source) =>
        source === 'bad'
          ? { kind: 'error', error: '読めません' }
          : { kind: 'ok', value: source },
    })

    expect(results.get('bad')).toEqual({ kind: 'error', error: '読めません' })
    expect(results.get('good')).toEqual({ kind: 'ok', value: 'good' })
  })
})

describe('sharePending', () => {
  test('同時に走る同じ鍵の呼び出しは 1 回にまとめる', async () => {
    // Arrange
    const run = vi.fn(async (key: string) => `rows of ${key}`)
    const rowsFor = sharePending(run)

    // Act
    const [first, second, other] = await Promise.all([
      rowsFor('#健康管理'),
      rowsFor('#健康管理'),
      rowsFor('#体温'),
    ])

    // Assert
    expect(first).toBe('rows of #健康管理')
    expect(second).toBe('rows of #健康管理')
    expect(other).toBe('rows of #体温')
    expect(run.mock.calls.map(([key]) => key)).toEqual(['#健康管理', '#体温'])
  })

  test('作り直せば控えは別になる', async () => {
    const run = vi.fn(async (key: string) => key)
    await sharePending(run)('q')
    await sharePending(run)('q')
    expect(run).toHaveBeenCalledTimes(2)
  })
})
