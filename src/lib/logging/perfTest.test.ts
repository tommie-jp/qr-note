import { describe, expect, test } from 'vitest'
import {
  PERF_TEST_QUERIES,
  runPerfTest,
  type PerfTestDeps,
  type PerfTestStatus,
} from './perfTest'

// 偽の手足で手順の並びを確かめる (DOM と時計を持ち込まない)
function fakeDeps(overrides: Partial<PerfTestDeps> = {}) {
  const calls: string[] = []
  const statuses: PerfTestStatus[] = []
  let clock = 0
  const deps: PerfTestDeps = {
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    isIdle: () => true,
    typeQuery: async (q) => {
      calls.push(`type:${q}`)
    },
    openNote: () => {
      calls.push('open')
      return true
    },
    sync: async () => {
      calls.push('sync')
    },
    send: (kind, fields) => {
      calls.push(`send:${kind}:${fields.map(([k, v]) => `${k}=${v}`).join(',')}`)
    },
    flush: () => {
      calls.push('flush')
    },
    report: (status) => {
      statuses.push(status)
    },
    describe: () => [['panes', '2']],
    ...overrides,
  }
  return { deps, calls, statuses }
}

describe('runPerfTest', () => {
  test('開始の印 → 検索 3 語 → ノート → 同期 → 完了の印の順に進む', async () => {
    const { deps, calls } = fakeDeps()

    await runPerfTest(deps)

    expect(calls.filter((c) => !c.startsWith('flush'))).toEqual([
      'send:テスト:結果=開始,panes=2',
      ...PERF_TEST_QUERIES.map((q) => `type:${q}`),
      'open',
      'sync',
      expect.stringMatching(/^send:テスト:結果=完了,全体=\d+ms$/),
    ])
    expect(calls.at(-1)).toBe('flush')
  })

  test('進み具合を段階ごとに知らせ、最後は完了', async () => {
    const { deps, statuses } = fakeDeps()

    await runPerfTest(deps)

    expect(statuses.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 5])
    expect(statuses.every((s) => s.total === 5)).toBe(true)
    expect(statuses.at(-1)?.done).toBe(true)
  })

  test('前の計測が閉じるまで次へ進まない', async () => {
    let busyPolls = 3
    const { deps, calls } = fakeDeps({
      isIdle: () => {
        if (busyPolls > 0) {
          busyPolls -= 1
          return false
        }
        return true
      },
    })

    await runPerfTest(deps)

    expect(busyPolls).toBe(0)
    expect(calls).toContain('sync')
  })

  test('閉じない計測は上限で見切って進む', async () => {
    const { deps, calls } = fakeDeps({ isIdle: () => false })

    await runPerfTest(deps)

    expect(calls).toContain('sync')
  })

  test('開けるノートが無ければ飛ばして印を残す', async () => {
    const { deps, calls } = fakeDeps({ openNote: () => false })

    await runPerfTest(deps)

    expect(calls).toContain('send:テスト:結果=ノートなし')
    expect(calls).toContain('sync')
  })

  test('同期が失敗しても完了の印まで進む', async () => {
    const { deps, calls } = fakeDeps({
      sync: async () => {
        throw new Error('offline')
      },
    })

    await runPerfTest(deps)

    expect(calls).toContain('send:テスト:結果=同期失敗')
    expect(calls.some((c) => c.startsWith('send:テスト:結果=完了'))).toBe(true)
  })
})
