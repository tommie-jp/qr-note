import { describe, expect, test } from 'vitest'
import {
  PERF_TEST_NOTE_INDEXES,
  PERF_TEST_QUERIES,
  PERF_TEST_VIEW_ORDER,
  runPerfTest,
  totalSteps,
  type PerfTestDeps,
  type PerfTestStatus,
} from './perfTest'

// 偽の手足で手順の並びを確かめる (DOM と時計を持ち込まない)
function fakeDeps(overrides: Partial<PerfTestDeps> = {}) {
  const calls: string[] = []
  const statuses: PerfTestStatus[] = []
  let clock = 0
  let view = 'compact'
  const deps: PerfTestDeps = {
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    isIdle: () => true,
    typeQuery: async (q) => {
      calls.push(`type:${q}`)
    },
    openNote: (index) => {
      calls.push(`open:${index}`)
      return true
    },
    scrollMore: () => {
      calls.push('scroll')
      return true
    },
    currentView: () => view,
    switchView: async (to, phase) => {
      calls.push(`view:${to}:${phase}`)
      view = to
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
    stop: async () => {
      calls.push('stop')
    },
    report: (status) => {
      statuses.push(status)
    },
    describe: () => [['panes', '2']],
    ...overrides,
  }
  return { deps, calls, statuses }
}

const withoutHousekeeping = (calls: string[]) =>
  calls.filter((c) => c !== 'flush' && c !== 'stop')

describe('runPerfTest', () => {
  test('開始の印 → 検索 → 表示モードの切替 → スクロール → ノート → 同期 → 完了の順に進む', async () => {
    const { deps, calls } = fakeDeps()

    await runPerfTest(deps)

    expect(withoutHousekeeping(calls)).toEqual([
      'send:テスト:結果=開始,panes=2',
      ...PERF_TEST_QUERIES.map((q) => `type:${q}`),
      // 空の検索 (全件) の 1 ページ目
      'type:',
      // 切替。まず小 (compact) に揃え、小→中→大→画像→小の 1 周を測る。
      // 開始時が compact なので揃える一手は要らず、最後の compact が「戻し」になる
      ...PERF_TEST_VIEW_ORDER.map((v) => `view:${v}:測定`),
      'view:compact:測定',
      'scroll',
      ...PERF_TEST_NOTE_INDEXES.map((i) => `open:${i}`),
      'sync',
      expect.stringMatching(/^send:テスト:結果=完了,全体=\d+ms$/),
    ])
    expect(calls.slice(-2)).toEqual(['flush', 'stop'])
  })

  test('開始時が小以外なら、先に小へ揃えてから 1 周し、最後に元の表示へ戻す (区分を付ける)', async () => {
    let view = 'image'
    const { deps, calls } = fakeDeps({
      currentView: () => view,
      switchView: async (to, phase) => {
        calls.push(`view:${to}:${phase}`)
        view = to
        return true
      },
    })

    await runPerfTest(deps)

    const switches = calls.filter((c) => c.startsWith('view:'))
    expect(switches).toEqual([
      'view:compact:揃え',
      ...PERF_TEST_VIEW_ORDER.map((v) => `view:${v}:測定`),
      'view:compact:測定',
      'view:image:戻し',
    ])
    expect(view).toBe('image')
  })

  test('表示モードは元の値へ必ず戻す', async () => {
    let view = 'card'
    const { deps, calls } = fakeDeps({
      currentView: () => view,
      switchView: async (to, phase) => {
        calls.push(`view:${to}:${phase}`)
        view = to
        return true
      },
    })

    await runPerfTest(deps)

    expect(view).toBe('card')
    expect(calls.filter((c) => c.startsWith('view:')).at(-1)).toBe('view:card:戻し')
  })

  test('切替の途中で例外が出ても元の表示モードへ戻す', async () => {
    let view = 'compact'
    let calls = 0
    const { deps } = fakeDeps({
      currentView: () => view,
      switchView: async (to, _phase) => {
        calls += 1
        if (calls === 2) throw new Error('boom')
        view = to
        return true
      },
    })

    await runPerfTest(deps)

    expect(view).toBe('compact')
  })

  test('進み具合を段階ごとに知らせ、最後は完了', async () => {
    const { deps, statuses } = fakeDeps()

    await runPerfTest(deps)

    // 分母は実際に数えた段階の数と一致する (最後の「完了」を除く)
    const counted = statuses.filter((x) => !x.done).length
    expect(counted).toBe(statuses[0]?.total)
    const total = statuses[0]?.total ?? 0
    expect(total).toBeGreaterThan(5)
    expect(statuses.every((s) => s.total === total)).toBe(true)
    expect(statuses.at(-1)?.done).toBe(true)
    // 段階は戻らない
    const steps = statuses.map((s) => s.step)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
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

    expect(calls.filter((c) => c === 'send:テスト:結果=ノートなし')).toHaveLength(
      PERF_TEST_NOTE_INDEXES.length,
    )
    expect(calls).toContain('sync')
  })

  test('続きを読む印が無い (全件が1ページ) なら飛ばして印を残す', async () => {
    const { deps, calls } = fakeDeps({ scrollMore: () => false })

    await runPerfTest(deps)

    expect(calls).toContain('send:テスト:結果=続きなし')
  })

  test('表示モードを切り替える釦が無ければ飛ばして印を残す', async () => {
    const { deps, calls } = fakeDeps({ switchView: async () => false })

    await runPerfTest(deps)

    expect(calls).toContain('send:テスト:結果=表示切替なし')
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

test('計測を止められなくても完了まで進み、そのことを知らせる', async () => {
  const { deps, statuses } = fakeDeps({
    stop: async () => {
      throw new Error('HTTP 500')
    },
  })

  await runPerfTest(deps)

  expect(statuses.at(-1)).toMatchObject({ done: true, label: '完了 (計測を止められませんでした)' })
})

describe('runPerfTest の回線 (docs/121 §4-1)', () => {
  test('回線を選んだときは開始の直後に回線を測り、分母も 1 つ増える', async () => {
    const { deps, calls, statuses } = fakeDeps({
      line: 'Wi-Fi',
      measureNet: async () => [
        ['RTT', '18ms'],
        ['下り', '85Mbps'],
      ],
    })

    await runPerfTest(deps)

    expect(calls.slice(0, 2)).toEqual([
      'send:テスト:結果=開始,panes=2,回線=Wi-Fi',
      'send:回線:種別=Wi-Fi,RTT=18ms,下り=85Mbps',
    ])
    expect(statuses[0]?.total).toBe(totalSteps(true))
    expect(totalSteps(true)).toBe(totalSteps(false) + 1)
    expect(statuses.filter((x) => !x.done)).toHaveLength(totalSteps(true))
  })

  test('回線が測れなくても残りの手順は流し、失敗を残す', async () => {
    const { deps, calls } = fakeDeps({
      line: 'キャリア',
      measureNet: async () => {
        throw new Error('offline')
      },
    })

    await runPerfTest(deps)

    expect(calls).toContain('send:回線:種別=キャリア,結果=失敗')
    expect(calls).toContain('sync')
  })

  test('回線を選ばなければ測らない (メニューの「計測開始」)', async () => {
    const { deps, calls, statuses } = fakeDeps()

    await runPerfTest(deps)

    expect(calls.some((c) => c.startsWith('send:回線'))).toBe(false)
    expect(statuses[0]?.total).toBe(totalSteps(false))
  })
})
