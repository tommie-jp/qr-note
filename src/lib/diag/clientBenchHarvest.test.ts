import { beforeEach, describe, expect, test, vi } from 'vitest'
import { parsePerfLine } from '../logging/perfLine'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  saved: [] as unknown[],
  lines: [] as { text: string; source: string; device?: string }[],
}))
vi.mock('./benchStore', () => ({
  saveClientBench: async (run: unknown) => {
    mocks.saved.push(run)
  },
}))
vi.mock('../logging/buffer', () => ({
  // 控えは新しい順で返す (buffer.ts の recentPerfLines と同じ)
  recentPerfLines: () => [...mocks.lines].reverse().map((l) => ({ at: 0, level: 'info', ...l })),
}))

const { hasPerfTestDone, harvestClientBench, sliceLatestRun, summarizeRun } = await import('./clientBenchHarvest')

const parsed = (texts: string[]) => texts.map((t) => parsePerfLine(t)!)

// 計測テスト 1 回分の行 (古い順)。docs/119 §1-1 の形
const RUN = [
  '[計測] テスト 結果=開始 panes=2 幅=390x844 回線=キャリア',
  '[計測] 回線 種別=キャリア RTT=60ms 下り=24Mbps 上り=8.5Mbps',
  '[計測] 検索 q="抵" 全体=500ms',
  '[計測] 検索 q="抵抗" panes=2 全体=420ms 要求=3ms 応答開始=250ms 受信=40ms 描画=120ms RSC=40KB/300KB サーバ=30ms(検索=5 特性=1)',
  '[計測] 検索 q="コンデンサ" 結果=中断 全体=200ms',
  '[計測] 検索 q="コンデンサ" 全体=380ms 応答開始=230ms',
  '[計測] 表示 切替=compact→medium 区分=測定 即時=50ms 全体=300ms',
  '[計測] 表示 切替=medium→card 区分=測定 即時=60ms 全体=320ms',
  '[計測] ノート 全体=900ms 応答開始=300ms',
  '[計測] ノート 全体=700ms 応答開始=280ms',
  '[計測] テスト 結果=続きなし',
  '[計測] 同期 結果=200 全体=1900ms 応答開始=350ms 転送=2300KB/10800KB',
  '[計測] テスト 結果=完了 全体=41000ms',
]

describe('summarizeRun', () => {
  test('回線・検索・表示・続き・ノート・同期・全体を表の行にする', () => {
    const rows = summarizeRun(parsed(RUN))

    expect(rows).toEqual([
      { label: '回線', value: 'RTT=60ms 下り=24Mbps 上り=8.5Mbps' },
      { label: '検索 抵抗', value: '全体=420ms 応答開始=250ms 受信=40ms 描画=120ms RSC=40KB/300KB' },
      { label: '検索 コンデンサ', value: '全体=380ms 応答開始=230ms' },
      { label: '表示 小→中', value: '即時=50ms 全体=300ms' },
      { label: '表示 中→大', value: '即時=60ms 全体=320ms' },
      { label: '続き', value: '続きなし' },
      { label: 'ノート 1', value: '全体=900ms 応答開始=300ms' },
      { label: 'ノート 2', value: '全体=700ms 応答開始=280ms' },
      { label: '同期', value: '結果=200 全体=1900ms 応答開始=350ms 転送=2300KB/10800KB' },
      { label: '全体', value: '41000ms' },
    ])
  })
})

describe('sliceLatestRun', () => {
  test('最新の開始から後だけを 1 回分にする', () => {
    const lines = parsed(['[計測] テスト 結果=開始 panes=3', '[計測] テスト 結果=完了 全体=1ms', ...RUN])

    expect(sliceLatestRun(lines)?.[0].fields.panes).toBe('2')
  })

  test('完了していない・途中で切れた回は null', () => {
    expect(sliceLatestRun(parsed(RUN.slice(0, -1)))).toBeNull()
    expect(sliceLatestRun(parsed([...RUN.slice(0, 3), '[計測] テスト 結果=中断', ...RUN.slice(-1)]))).toBeNull()
  })
})

describe('harvestClientBench', () => {
  beforeEach(() => {
    mocks.saved = []
    mocks.lines = []
  })

  test('その端末のブラウザの行だけで要約して保存する', async () => {
    mocks.lines = [
      ...RUN.map((text) => ({ text, source: 'browser', device: 'iPhone' })),
      // 別の端末とサーバの行は混ぜない
      { text: '[計測] テスト 結果=開始 panes=3', source: 'browser', device: 'PC' },
      { text: '[計測] 検索/サーバ q="抵抗" サーバ=30ms', source: 'server' },
    ]

    const saved = await harvestClientBench('iPhone', new Date('2026-10-29T05:00:00Z'))

    expect(saved).toBe(true)
    expect(mocks.saved).toEqual([
      expect.objectContaining({ device: 'iPhone', line: 'キャリア', panes: '2', width: '390x844', measuredAt: '2026-10-29T05:00:00.000Z' }),
    ])
  })

  test('回線の無い回 (メニューの計測開始) は「不明」として保存する', async () => {
    mocks.lines = RUN.filter((t) => !t.startsWith('[計測] 回線')).map((text) => ({
      text: text.replace(' 回線=キャリア', ''),
      source: 'browser',
      device: 'PC',
    }))

    await harvestClientBench('PC')

    expect(mocks.saved).toEqual([expect.objectContaining({ line: '不明' })])
  })

  test('開始の行の値は長さを切って保存する (偽の行でファイルを膨らませない)', async () => {
    mocks.lines = RUN.map((text, i) => ({
      text: i === 0 ? text.replace('panes=2', `panes=${'x'.repeat(5000)}`) : text,
      source: 'browser',
      device: 'PC',
    }))

    await harvestClientBench('PC')

    expect((mocks.saved[0] as { panes: string }).panes).toHaveLength(32)
  })

  test('揃わなければ保存しない', async () => {
    mocks.lines = [{ text: RUN[0], source: 'browser', device: 'PC' }]

    expect(await harvestClientBench('PC')).toBe(false)
    expect(mocks.saved).toEqual([])
  })
})

test('hasPerfTestDone は完了の行だけに反応する', () => {
  expect(hasPerfTestDone(['[計測] テスト 結果=完了 全体=1ms'])).toBe(true)
  expect(hasPerfTestDone(['[計測] テスト 結果=開始', '[計測] 検索 q="完了"'])).toBe(false)
})
