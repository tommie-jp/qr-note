import { describe, expect, test } from 'vitest'
import { NAV_CHECK_STEPS, runNavChecks, type NavCheckDeps } from './perfNavCheck'

// 偽の画面 (履歴・ペイン構成・要求の記録) で手順と判定を確かめる (docs/123 §12-6)
interface FakeOptions {
  // 戻るで殻 (/item の RSC) を取りに行く (端末で開けていない)
  backFetchesShell?: boolean
  // ペイン釦で検索画面が全画面のノートに置き換わる
  paneBreaksList?: boolean
  // タッチ端末でない (引っ張って更新が無い)
  noTouch?: boolean
}

const PANE_NEXT: Record<string, string> = { '3': '2', '2': '1', '1': '3' }

function fakeWorld(options: FakeOptions = {}) {
  let clock = 0
  const history = ['/']
  let index = 0
  let panes = '2'
  let hasList = true
  let scrollY = 0
  let refreshDeferred = false
  let nextCount = 0
  const requests: { path: string; rsc: boolean; at: number }[] = []
  const sent: Record<string, string>[] = []
  const steps: string[] = []

  const path = () => history[index]
  const isNote = (p: string) => p.startsWith('/item/')
  // 一覧へ戻ったら、遅らせた refresh が流れる (navigation.ts の flushDeferredRefresh)
  const arrive = () => {
    if (!isNote(path()) && refreshDeferred) {
      requests.push({ path: '/', rsc: true, at: clock })
      refreshDeferred = false
    }
    if (options.backFetchesShell && isNote(path())) {
      requests.push({ path: path(), rsc: true, at: clock })
    }
  }
  const push = (to: string) => {
    history.splice(index + 1)
    history.push(to)
    index += 1
  }

  const deps: NavCheckDeps = {
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    snapshot: () => ({
      path: path(),
      // 2 / 3 ペインは一覧へ戻ってもノートを出したまま (keepOpen)。1 ペインは閉じる
      noteId: isNote(path()) ? path().slice('/item/'.length) : panes === '1' ? null : 'kept',
      hasList,
      panes,
      scrollY,
    }),
    rscSince: (p, t0) => requests.filter((r) => r.rsc && r.path === p && r.at >= t0).length,
    apiSince: (p, t0) => requests.filter((r) => !r.rsc && r.path === p && r.at >= t0).length,
    back: () => {
      index = Math.max(0, index - 1)
      arrive()
    },
    forward: () => {
      index = Math.min(history.length - 1, index + 1)
      arrive()
    },
    clickNext: () => {
      nextCount += 1
      push(`/item/next${nextCount}`)
      return true
    },
    pressPaneButton: () => {
      panes = PANE_NEXT[panes]
      if (isNote(path())) refreshDeferred = true
      if (options.paneBreaksList) hasList = false
      return true
    },
    pressViewButton: () => {
      if (isNote(path())) refreshDeferred = true
      return true
    },
    pullToRefresh: async () => {
      if (options.noTouch) return false
      requests.push({ path: '/api/items', rsc: false, at: clock })
      refreshDeferred = true
      return true
    },
    clickClose: () => {
      deps.back()
      return true
    },
    openNote: (i) => {
      push(`/item/n${i}`)
      return true
    },
    // 検索窓に打つと URL は今の項目の置き換え (SearchNav の replaceState)
    typeQuery: async (q) => {
      history[index] = `/?q=${q}`
    },
    scrollListBy: (dy) => {
      scrollY += dy
    },
    send: (kind, fields) => {
      if (kind === '遷移') sent.push(Object.fromEntries(fields.map(([k, v]) => [k, String(v)])))
    },
  }
  return { deps, sent, steps, panes: () => panes }
}

const verdicts = (sent: Record<string, string>[]) => sent.map((f) => `${f['操作']}=${f['判定']}`)

describe('runNavChecks', () => {
  test('端末で開けていれば準備と 8 つの操作がすべて OK になり、ペイン構成は元へ戻る', async () => {
    const { deps, sent, steps, panes } = fakeWorld()

    await runNavChecks(deps, (label) => steps.push(label))

    expect(steps).toHaveLength(NAV_CHECK_STEPS)
    expect(verdicts(sent)).toEqual([
      '戻る=OK',
      '進む=OK',
      '次へ=OK',
      '開いたまま表示切替=OK',
      '開いたままペイン切替=OK',
      '開いたまま引っ張って更新=OK',
      '一覧へ戻る=OK',
      '1ペインで閉じる=OK',
    ])
    expect(sent.find((f) => f['操作'] === '一覧へ戻る')?.['更新']).toBe('1')
    expect(panes()).toBe('2')
  })

  test('戻るで殻を取りに行ったら NG にする', async () => {
    const { deps, sent } = fakeWorld({ backFetchesShell: true })

    await runNavChecks(deps, () => {})

    expect(sent[0]).toMatchObject({ 操作: '戻る', 判定: 'NG', RSC: '1', 理由: '殻を取りに行った' })
  })

  test('ペイン切替で一覧が消えたら NG にする (全画面のノートへの置き換わり)', async () => {
    const { deps, sent } = fakeWorld({ paneBreaksList: true })

    await runNavChecks(deps, () => {})

    expect(sent.find((f) => f['操作'] === '開いたままペイン切替')).toMatchObject({
      判定: 'NG',
      理由: '一覧が消えた',
    })
  })

  test('操作の途中で検索画面ごと置き換わって釦が消えたら「一覧が消えた」', async () => {
    const { deps, sent } = fakeWorld()
    let presses = 0
    deps.pressViewButton = () => {
      presses += 1
      return presses === 1
    }
    const snapshot = deps.snapshot
    deps.snapshot = () => ({ ...snapshot(), hasList: presses === 0 })

    await runNavChecks(deps, () => {})

    expect(sent.find((f) => f['操作'] === '開いたまま表示切替')).toMatchObject({ 判定: 'NG', 理由: '一覧が消えた' })
  })

  test('タッチ端末でなければ引っ張って更新は飛ばして OK と記す', async () => {
    const { deps, sent } = fakeWorld({ noTouch: true })

    await runNavChecks(deps, () => {})

    expect(sent.find((f) => f['操作'] === '開いたまま引っ張って更新')).toMatchObject({
      判定: 'OK',
      理由: 'タッチ端末でない',
    })
  })

  test('準備でノートを開けなければ NG を 1 行だけ残して戻る', async () => {
    const { deps, sent, steps } = fakeWorld()
    deps.openNote = () => false

    await runNavChecks(deps, (label) => steps.push(label))

    expect(steps).toEqual(['遷移: 準備'])
    expect(sent).toEqual([{ 操作: '準備', 判定: 'NG', 理由: 'ノートを開けない' }])
  })
})
