// ブラウザ側のプロファイル (docs/127 §4)。
//
// 本番ビルド (docs/118 §0-1 の :perf を 3301 番) を Playwright で開き、決まった
// 手順の各段で次を取る:
//   - 所要: 文書の始まり (navigation start) から、最後に DOM の中身が変わった
//     時刻まで。load の後、DOM の変化が QUIET_MS 止まるまで待って決める。
//     networkidle は使わない — ノートの画面は接続を張りっぱなしにするので
//     いつまでも来ない。main thread が空くまで (requestIdleCallback) も使わない —
//     速い PC では一覧の API が返る前に空き、殻だけを測ってしまう
//   - 転送量 (CDP の encodedDataLength)
//   - CDP Performance.getMetrics の Script / Layout / RecalcStyle / Task の時間。
//     文書ごとの累計なので、毎段 goto で開き直す (段の値 = その文書の値)
//   - GC 後の JS ヒープと DOM ノード数 (HeapProfiler.collectGarbage の後)
// 最後に検索窓で 2 語を 10 往復し、GC 後のヒープとノード数の推移を残す
// (同じ文書の中の遷移なので、伸び続けるならリークを疑う)。
//
// Profiler (サンプリング) は main thread を太らせるので使わない
// (memory: browser-profile-recipe)。
//
//   npx tsx scripts/profileBrowser.ts [出力先.json] [回数]
//   PROFILE_BASE_URL=http://localhost:3301 PROFILE_USER=e2e PROFILE_PASS=e2e-test-pass
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test'

const BASE_URL = process.env.PROFILE_BASE_URL ?? 'http://localhost:3301'
const USER = process.env.PROFILE_USER ?? 'e2e'
const PASS = process.env.PROFILE_PASS ?? 'e2e-test-pass'
const OUT = process.argv[2] ?? 'perf-baseline/browser.json'
const RUNS = Number(process.argv[3] ?? 6)
const LEAK_ROUNDS = 10
const MB = 1024 * 1024
const NAV_TIMEOUT_MS = 60_000
// DOM の変化がこれだけ止まったら描き終わりとみなす
const QUIET_MS = 800
// 描き終わりを待つ上限 (時計などで変化が止まらない画面でも抜ける)
const SETTLE_TIMEOUT_MS = 15_000

interface Profile {
  name: string
  viewport: { width: number; height: number }
  // CDP Emulation.setCPUThrottlingRate (1 = 絞らない)
  cpuRate: number
  panes: string
  isMobile: boolean
  // 検索の往復を回すか (リークの確認は PC の 1 本で足りる。CPU を絞った端末で
  // 回すと時間ばかりかかる)
  leakRounds: boolean
}

// PC (3 ペイン) と iPhone 相当 (1 ペイン・CPU 4 倍の絞り)
const PROFILES: readonly Profile[] = [
  { name: 'PC-3ペイン', viewport: { width: 1600, height: 1000 }, cpuRate: 1, panes: '3', isMobile: false, leakRounds: true },
  { name: 'iPhone相当-1ペイン', viewport: { width: 390, height: 844 }, cpuRate: 4, panes: '1', isMobile: true, leakRounds: false },
]

interface Step {
  name: string
  // 開く URL (null ならノートの段 — 直前の検索の 1 件目の href を使う)
  path: string | null
  // これが現れるまで待ってから静まりを見る (一覧は API の応答の後に出る)
  ready?: string
}

const RESULT_LINK = 'a[href^="/item/"]'

const STEPS: readonly Step[] = [
  { name: '検索「抵抗」', path: '/?q=抵抗', ready: RESULT_LINK },
  { name: '検索「コンデンサ」', path: '/?q=コンデンサ', ready: RESULT_LINK },
  { name: '検索「オペアンプ」', path: '/?q=オペアンプ', ready: RESULT_LINK },
  { name: '検索 (全件)', path: '/', ready: RESULT_LINK },
  { name: 'ノート (全件の 1 件目)', path: null },
  { name: 'カレンダー', path: '/calendar' },
  { name: '設定', path: '/settings' },
]

type Metrics = Record<string, number>

interface StepSample {
  ms: number
  transferKB: number
  scriptMs: number
  layoutMs: number
  styleMs: number
  taskMs: number
  heapAfterGcMB: number
  nodes: number
}

async function metrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics: list } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(list.map((m) => [m.name, m.value]))
}

async function heapAfterGc(cdp: CDPSession): Promise<{ heapMB: number; nodes: number }> {
  await cdp.send('HeapProfiler.collectGarbage')
  const m = await metrics(cdp)
  return { heapMB: round1(m.JSHeapUsedSize / MB), nodes: m.Nodes }
}

const round1 = (value: number): number => Math.round(value * 10) / 10
const secToMs = (sec: number): number => round1(sec * 1000)

// 転送量の数え上げ。段の頭で 0 に戻す
function trackTransfer(cdp: CDPSession): { reset: () => void; kb: () => number } {
  let bytes = 0
  cdp.on('Network.loadingFinished', (event) => {
    bytes += event.encodedDataLength
  })
  return { reset: () => (bytes = 0), kb: () => Math.round(bytes / 1024) }
}

// load の後、DOM の中身 (要素の出入り・文字) の変化が QUIET_MS 止まるまで待ち、
// 最後に変わった時刻 (文書の始まりからの ms) を返す
async function settle(page: Page, ready?: string): Promise<number> {
  await page.waitForLoadState('load')
  if (ready) {
    await page.locator(ready).first().waitFor({ state: 'attached', timeout: NAV_TIMEOUT_MS })
  }
  return page.evaluate(
    ({ quiet, timeout }) =>
      new Promise<number>((resolve) => {
        let last = performance.now()
        const started = last
        const observer = new MutationObserver(() => {
          last = performance.now()
        })
        observer.observe(document, { subtree: true, childList: true, characterData: true })
        const tick = () => {
          const now = performance.now()
          if (now - last >= quiet || now - started >= timeout) {
            observer.disconnect()
            resolve(last)
            return
          }
          setTimeout(tick, 100)
        }
        setTimeout(tick, 100)
      }),
    { quiet: QUIET_MS, timeout: SETTLE_TIMEOUT_MS },
  )
}

async function visit(page: Page, path: string, ready?: string): Promise<number> {
  await page.goto(new URL(path, BASE_URL).toString(), { waitUntil: 'load' })
  return settle(page, ready)
}

async function firstNoteHref(page: Page): Promise<string> {
  const href = await page.locator('a[href^="/item/"]').first().getAttribute('href')
  if (!href) {
    throw new Error('検索結果にノートへのリンクが無い')
  }
  return href
}

async function openContext(profile: Profile): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    httpCredentials: { username: USER, password: PASS },
  })
  const host = new URL(BASE_URL).hostname
  await context.addCookies([
    { name: 'panes', value: profile.panes, domain: host, path: '/' },
    { name: 'view', value: 'compact', domain: host, path: '/' },
  ])
  // tsx (esbuild の keepNames) は page.evaluate に渡す関数の中にも __name(…) を
  // 差し込む。ページには無いので素通しを置く
  await context.addInitScript({ content: 'globalThis.__name = (fn) => fn' })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS)
  const auth = new URL('/login', BASE_URL)
  auth.username = USER
  auth.password = PASS
  await page.goto(auth.toString(), { waitUntil: 'load' })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('Network.enable')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate })
  return { context, page, cdp }
}

async function runSteps(page: Page, cdp: CDPSession): Promise<StepSample[]> {
  const transfer = trackTransfer(cdp)
  const samples: StepSample[] = []
  let noteHref = ''
  for (const step of STEPS) {
    const path = step.path ?? noteHref
    transfer.reset()
    const ms = await visit(page, path, step.ready)
    const after = await metrics(cdp)
    const { heapMB, nodes } = await heapAfterGc(cdp)
    if (step.path === '/') {
      noteHref = await firstNoteHref(page)
    }
    samples.push({
      ms: Math.round(ms),
      transferKB: transfer.kb(),
      scriptMs: secToMs(after.ScriptDuration),
      layoutMs: secToMs(after.LayoutDuration),
      styleMs: secToMs(after.RecalcStyleDuration),
      taskMs: secToMs(after.TaskDuration),
      heapAfterGcMB: heapMB,
      nodes,
    })
  }
  return samples
}

interface LeakRound {
  round: number
  heapMB: number
  nodes: number
  // 往復で引いた語
  queries?: string
  // 往復の間に文書が作り直されたか (作り直されたらヒープも新しく、リークの
  // 確認にならない)
  reloaded?: boolean
}

const documentOrigin = (page: Page): Promise<number> => page.evaluate(() => performance.timeOrigin)

const SEARCH_BOX = 'input[type="search"][name="q"]'
const LEAK_QUERIES = ['コンデンサ', '抵抗'] as const

// 同じ文書の中で検索窓から 2 語を交互に引き直す (クライアント側の遷移)。
// 結果のリンクを押すと /item へ文書ごと移る (戻ると作り直される) ので、
// 往復には検索窓を使う。文書が作り直されていないことも残す
async function runLeakRounds(page: Page, cdp: CDPSession): Promise<LeakRound[]> {
  await visit(page, '/?q=抵抗', RESULT_LINK)
  const origin = await documentOrigin(page)
  const rounds: LeakRound[] = [{ round: 0, ...(await heapAfterGc(cdp)) }]
  for (let round = 1; round <= LEAK_ROUNDS; round += 1) {
    for (const query of LEAK_QUERIES) {
      const box = page.locator(SEARCH_BOX).first()
      await box.fill(query)
      await box.press('Enter')
      await page.waitForURL((url) => url.searchParams.get('q') === query)
      await settle(page, RESULT_LINK)
    }
    const reloaded = (await documentOrigin(page)) !== origin
    rounds.push({ round, ...(await heapAfterGc(cdp)), queries: LEAK_QUERIES.join('↔'), reloaded })
  }
  return rounds
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : round1((sorted[mid - 1] + sorted[mid]) / 2)
}

type Summary = Record<keyof StepSample, { median: number; min: number; max: number }>

function summarize(samples: readonly StepSample[]): Summary {
  const keys = Object.keys(samples[0]) as (keyof StepSample)[]
  return Object.fromEntries(
    keys.map((key) => {
      const values = samples.map((s) => s[key])
      return [key, { median: median(values), min: Math.min(...values), max: Math.max(...values) }]
    }),
  ) as Summary
}

async function profileOne(profile: Profile) {
  const { context, page, cdp } = await openContext(profile)
  try {
    const runs: StepSample[][] = []
    for (let run = 1; run <= RUNS; run += 1) {
      const samples = await runSteps(page, cdp)
      console.error(`${profile.name} ${run}/${RUNS}: ${samples.map((s) => s.ms).join(' / ')} ms`)
      runs.push(samples)
    }
    // 1 回目は暖機 (サーバ側の記憶・ブラウザのキャッシュが温まる前) として捨てる
    const kept = runs.slice(1)
    const steps = STEPS.map((step, i) => ({ step: step.name, ...summarize(kept.map((r) => r[i])) }))
    const leak = profile.leakRounds ? await runLeakRounds(page, cdp) : []
    return { profile: profile.name, viewport: profile.viewport, cpuRate: profile.cpuRate, runs: kept.length, steps, leak }
  } finally {
    await context.browser()?.close()
  }
}

async function main(): Promise<void> {
  const results = []
  for (const profile of PROFILES) {
    results.push(await profileOne(profile))
  }
  const report = { baseUrl: BASE_URL, measuredAt: new Date().toISOString(), results }
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(report, null, 2))
  console.log(OUT)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
