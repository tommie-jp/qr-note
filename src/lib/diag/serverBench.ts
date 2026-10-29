// サーバ側ベンチ (docs/121-QR-Noteベンチマーク計画.md §3)。
//
// ブラウザ無しで、QR-Note の典型的な処理の関数を直接呼んで測る。
// loadSearchResults や markdownPipeline は Server Component の文脈 (cookie・
// RSC) に依るので呼ばず、下の層 (searchItems・解析・makeThumbnail・同期の
// 組み立て) を使う。
//
// 項目ごとに「ならし 1 回 + 計測 3 回」の中央値を取る (VPS の CPU はぶれる。
// DB は 1 回目だけ遅い)。失敗した項目は除いて保存し、理由を残す
// (1 つの失敗で全部を捨てない。黙って欠けさせもしない)
import 'server-only'
import os from 'node:os'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { brotliQualityFor, SYNC_GZIP_LEVEL } from '@/lib/route/compress'
import sharp from 'sharp'
import pkg from '../../../package.json'
import { prisma } from '@/lib/db'
import { makeThumbnail } from '@/lib/images/thumbnail'
import { searchItems } from '@/lib/items/search'
import { loadOfflineSyncPayload } from '@/lib/offline/syncItems'
import { safeErrorText } from './safeErrorText'
import { BENCH_FIXTURE_MD } from './benchFixture'
import { profileCpu, readBundleSourceMap } from './benchProfile'
import { type CpuProfile, type ModuleTime, remapProfile, summarizeByModule } from './profileRemap'
import { profilePath, saveServerBench, writeAtomic } from './benchStore'
import type { BenchEnv, ServerBenchItem, ServerBenchResult } from './benchTypes'
import { parseBatch } from './parseBench'

const WARMUP_RUNS = 1
const MEASURE_RUNS = 3
// 冷えた解析に使う回路ノートの数。id (UUID v7) 順に固定で選ぶので回ごとに変わらない
export const COLD_PARSE_ITEMS = 20
// 見本は 1 件が数 ms なので、まとめて回してぶれを均す
const FIXTURE_REPEAT = 10
// 検索語 (計測テスト docs/120 と同じ 3 語 + 全件)
export const BENCH_QUERIES = ['抵抗', 'コンデンサ', 'オペアンプ', ''] as const
// サムネの材料の寸法 (スマホの写真を縮めた程度)
const THUMB_WIDTH = 1200
const THUMB_HEIGHT = 900
const MB = 1024 * 1024

export interface BenchSample {
  totalMs: number
  phases: Record<string, number>
  scale: string
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ならしの後に計測を回し、全体と段階ごとの中央値を取る。規模は最後の回
export async function sampleMedian(run: () => Promise<BenchSample>): Promise<Omit<ServerBenchItem, 'id' | 'label' | 'fixed'>> {
  for (let i = 0; i < WARMUP_RUNS; i += 1) {
    await run()
  }
  const samples: BenchSample[] = []
  for (let i = 0; i < MEASURE_RUNS; i += 1) {
    samples.push(await run())
    // 回の間に順番を譲る (ほかの要求を待たせ続けない)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const phaseNames = Object.keys(samples[0]?.phases ?? {})
  const phases = Object.fromEntries(
    phaseNames.map((name) => [name, round1(median(samples.map((s) => s.phases[name] ?? 0)))]),
  )
  return {
    medianMs: round1(median(samples.map((s) => s.totalMs))),
    phases,
    scale: samples.at(-1)?.scale ?? '',
  }
}

const round1 = (ms: number): number => Math.round(ms * 10) / 10

const elapsed = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const started = performance.now()
  const value = await fn()
  return { value, ms: performance.now() - started }
}

// 決まった模様のノイズ画像 (JPEG)。ノイズにするのは、平らな画像だと縮小も
// 圧縮も一瞬で終わり、写真の重さにならないため。乱数を固定の種で作るので
// 毎回同じ材料になる
export async function makeNoiseJpeg(width = THUMB_WIDTH, height = THUMB_HEIGHT): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3)
  let seed = 0x2545f491
  for (let i = 0; i < raw.length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    // 斜めの濃淡 + 小さなノイズ (写真に近い圧縮率にする)
    const x = Math.floor(i / 3) % width
    const y = Math.floor(i / 3 / width)
    raw[i] = ((x + y) / 8 + (seed >>> 27)) & 0xff
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer())
}

// 回路フェンスを持つノートを固定で選ぶ。判定は position — **LIKE は PGroonga が
// 乗っ取る**ので使わない
async function loadColdMemos(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ memo: string }[]>`
    SELECT memo FROM items
    WHERE deleted_at IS NULL AND position('circuit' in memo) > 0
    ORDER BY id
    LIMIT ${COLD_PARSE_ITEMS}
  `
  return rows.map((row) => row.memo)
}

export async function collectBenchEnv(): Promise<BenchEnv> {
  const [counts] = await prisma.$queryRaw<{ items: number; circuit: number }[]>`
    SELECT count(*)::int AS items,
           count(*) FILTER (WHERE position('circuit' in memo) > 0)::int AS circuit
    FROM items WHERE deleted_at IS NULL
  `
  return {
    cpuModel: os.cpus()[0]?.model.trim() ?? '不明',
    threads: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / MB),
    nodeVersion: process.version,
    appVersion: pkg.version,
    items: counts?.items ?? 0,
    circuitItems: counts?.circuit ?? 0,
    measuredAt: new Date().toISOString(),
  }
}

interface BenchTask {
  id: string
  label: string
  fixed: boolean
  run: () => Promise<BenchSample>
}

function searchTasks(): BenchTask[] {
  return BENCH_QUERIES.map((q) => ({
    id: `search:${q === '' ? '全件' : q}`,
    label: q === '' ? '検索 (全件)' : `検索「${q}」`,
    fixed: false,
    run: async () => {
      const { value, ms } = await elapsed(() => searchItems(q, 1))
      return { totalMs: ms, phases: {}, scale: `${value.items.length}/${value.total} 件` }
    },
  }))
}

const parseSample = async (memos: readonly string[], scale: (fences: number) => string): Promise<BenchSample> => {
  const r = await parseBatch(memos)
  return { totalMs: r.totalMs, phases: { ...r.stages }, scale: scale(r.fences) }
}

function parseTasks(coldMemos: readonly string[]): BenchTask[] {
  const fixture = Array.from({ length: FIXTURE_REPEAT }, () => BENCH_FIXTURE_MD)
  const kb = Math.round(Buffer.byteLength(BENCH_FIXTURE_MD) / 1024)
  return [
    {
      id: 'parse:cold',
      label: `回路の解析 (実ノート ${COLD_PARSE_ITEMS} 件・控えなし)`,
      fixed: false,
      run: () => parseSample(coldMemos, (fences) => `${coldMemos.length} 件・${fences} 図`),
    },
    {
      id: 'parse:fixture',
      label: `回路の解析 (見本 ${kb}KB × ${FIXTURE_REPEAT})`,
      fixed: true,
      run: () => parseSample(fixture, (fences) => `${FIXTURE_REPEAT} 件・${fences} 図`),
    },
  ]
}

function thumbTask(jpeg: Uint8Array): BenchTask {
  return {
    id: 'thumb:fixture',
    label: `サムネ生成 (${THUMB_WIDTH}×${THUMB_HEIGHT} JPEG)`,
    fixed: true,
    run: async () => {
      const { value, ms } = await elapsed(() => makeThumbnail(jpeg, 'ベンチマーク'))
      if (value === null) {
        throw new Error('サムネを作れなかった (sharp が動いていない)')
      }
      return { totalMs: ms, phases: {}, scale: `${Math.round(jpeg.byteLength / 1024)}KB → ${Math.round(value.byteLength / 1024)}KB` }
    },
  }
}

// 同期の組み立て (/api/sync/items の中身)。回路の解析は記憶 (circuitFencesOf) を
// 通るので、ならしの後は db・json・圧縮の重さになる (普段の同期と同じ形)。
// 圧縮は本番の端末 (HTTPS) が受ける brotli で合計を出し、前と比べるために
// gzip の時間も測って段階に残す (docs/124 §3)
const syncTask: BenchTask = {
  id: 'sync:payload',
  label: '同期の組み立て (db → json → brotli)',
  fixed: false,
  run: async () => {
    const db = await elapsed(() => loadOfflineSyncPayload())
    const t0 = performance.now()
    const json = JSON.stringify(db.value)
    const t1 = performance.now()
    // 同期の口と同じ強さ。口は非同期で圧縮するが、ここは CPU の重さを測るので同期で
    const bytes = Buffer.byteLength(json)
    const br = brotliCompressSync(json, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQualityFor(bytes),
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes,
      },
    })
    const t2 = performance.now()
    const gz = gzipSync(json, { level: SYNC_GZIP_LEVEL })
    const t3 = performance.now()
    const mb = (bytes: number) => (bytes / MB).toFixed(1)
    return {
      totalMs: db.ms + (t2 - t0),
      phases: { db: db.ms, json: t1 - t0, brotli: t2 - t1, gzip: t3 - t2 },
      scale: `${db.value.items.length} 件・${mb(bytes)}MB → br ${mb(br.byteLength)}MB (gzip ${mb(gz.byteLength)}MB)`,
    }
  },
}

// 検索ページ全体の組み立て (docs/122 §5)。自分自身へ RSC の要求を撃ち、ヘッダが
// 届くまで (応答開始) と本文を読み切るまでを測る。DB の検索 (search:*) は数 ms
// なのに、本番の端末では応答開始が数百 ms ある — その差がページの組み立て。
//
// cookie は押した管理者の要求から写す (同じプロセスへのループバックで、外へは
// 出ない)。ペイン構成と表示モードは環境どうしで比べられるよう固定で上書きする
export const PAGE_BENCH_QUERY = '抵抗'
const PAGE_BENCH_PREFS: readonly (readonly [string, string])[] = [
  ['panes', '3'],
  ['view', 'compact'],
]

export function pageBenchCookie(cookies: readonly { name: string; value: string }[]): string {
  const fixed = new Set(PAGE_BENCH_PREFS.map(([name]) => name))
  return [...cookies.filter((c) => !fixed.has(c.name)).map((c) => [c.name, c.value] as const), ...PAGE_BENCH_PREFS]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function pageTask(cookie: string, origin: string): BenchTask {
  return {
    id: 'page:search',
    label: `検索ページの組み立て「${PAGE_BENCH_QUERY}」(3 ペイン・小)`,
    fixed: false,
    run: async () => {
      const started = performance.now()
      // `_rsc` は最初から付ける。無いと Next が付けた URL へ 307 で転送し、その往復が
      // 応答開始に混ざる (Next 16 は RSC の要求にこの引数を求める。値は空でよい)
      const res = await fetch(`${origin}/?q=${encodeURIComponent(PAGE_BENCH_QUERY)}&_rsc`, {
        headers: { RSC: '1', Cookie: cookie },
        redirect: 'manual',
        cache: 'no-store',
      })
      const headersAt = performance.now()
      const body = await res.arrayBuffer()
      const ended = performance.now()
      if (res.status !== 200) {
        throw new Error(`自分への要求が HTTP ${res.status} (ログインや待ち受けのポートを確かめる)`)
      }
      return {
        totalMs: ended - started,
        phases: { 応答開始: headersAt - started, 本文: ended - headersAt },
        scale: `${Math.round(body.byteLength / 1024)}KB`,
      }
    },
  }
}

// 検索 API の組み立て (docs/123 §6)。C/S 化の後は一覧の材料がこちらに載る。
// page:search (殻だけになった) と並べて、サーバの持ち分を測る
function apiTask(cookie: string, origin: string): BenchTask {
  return {
    id: 'api:search',
    label: `検索 API「${PAGE_BENCH_QUERY}」(小・1 ページ目)`,
    fixed: false,
    run: async () => {
      const started = performance.now()
      const params = new URLSearchParams({ q: PAGE_BENCH_QUERY, view: 'compact', page: '1' })
      const res = await fetch(`${origin}/api/items?${params}`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
        cache: 'no-store',
      })
      const headersAt = performance.now()
      const body = await res.arrayBuffer()
      const ended = performance.now()
      if (res.status !== 200) {
        throw new Error(`自分への要求が HTTP ${res.status} (ログインや待ち受けのポートを確かめる)`)
      }
      return {
        totalMs: ended - started,
        phases: { 応答開始: headersAt - started, 本文: ended - headersAt },
        scale: `${Math.round(body.byteLength / 1024)}KB`,
      }
    },
  }
}

async function runTasks(tasks: readonly BenchTask[]): Promise<Pick<ServerBenchResult, 'items' | 'failed'>> {
  const items: ServerBenchItem[] = []
  const failed: ServerBenchResult['failed'] = []
  for (const task of tasks) {
    try {
      const sample = await sampleMedian(task.run)
      items.push({ id: task.id, label: task.label, fixed: task.fixed, ...sample })
    } catch (error) {
      console.warn(`サーバ側ベンチ: ${task.label} に失敗`, error)
      failed.push({ id: task.id, message: safeErrorText(error) })
    }
  }
  return { items, failed }
}

// 冷えた解析をもう 1 回、プロファイルを取りながら回す。計測の回には混ぜない
// (プロファイラの負担で遅くなる)。保存の前に束ねの位置を元のモジュールへ引き直し
// (docs/122 §4)、モジュールごとの自己時間を画面用に畳んで返す
async function saveParseProfile(coldMemos: readonly string[]): Promise<ModuleTime[]> {
  const memos = coldMemos.length > 0 ? coldMemos : [BENCH_FIXTURE_MD]
  const { profile } = await profileCpu(() => parseBatch(memos))
  const remapped = remapProfile(profile as CpuProfile, readBundleSourceMap)
  await writeAtomic(profilePath(), JSON.stringify(remapped))
  return summarizeByModule(remapped)
}

export interface ServerBenchOptions {
  // 検索ページの組み立て (page:search) に使う cookie。無ければその項目を飛ばす
  pageCookie?: string
  // 自分自身の待ち受け (standalone の server.js は 0.0.0.0:PORT)
  origin?: string
}

// standalone の server.js は環境変数 HOSTNAME のアドレスで待ち受ける。docker は
// HOSTNAME にコンテナ名を入れるので、127.0.0.1 では届かない (ECONNREFUSED)。
// 0.0.0.0 (すべて) や未設定なら 127.0.0.1 で届く
export function selfOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const host = env.HOSTNAME && env.HOSTNAME !== '0.0.0.0' ? env.HOSTNAME : '127.0.0.1'
  return `http://${host}:${env.PORT || '3000'}`
}

export async function runServerBench(options: ServerBenchOptions = {}): Promise<ServerBenchResult> {
  const env = await collectBenchEnv()
  const coldMemos = await loadColdMemos()
  const jpeg = await makeNoiseJpeg()
  const tasks: BenchTask[] = [
    ...searchTasks(),
    // 回路ノートが 1 件も無い DB (新しい移行先など) では実ノートの行を飛ばす
    ...parseTasks(coldMemos).filter((task) => coldMemos.length > 0 || task.fixed),
    thumbTask(jpeg),
    syncTask,
    ...(options.pageCookie === undefined
      ? []
      : [
          pageTask(options.pageCookie, options.origin ?? selfOrigin()),
          apiTask(options.pageCookie, options.origin ?? selfOrigin()),
        ]),
  ]
  const { items, failed } = await runTasks(tasks)
  const profile = await saveParseProfile(coldMemos).then(
    (modules) => ({ modules, failed: [] }),
    (error: unknown) => {
      console.warn('サーバ側ベンチ: プロファイルの保存に失敗', error)
      return { modules: [], failed: [{ id: 'profile', message: safeErrorText(error) }] }
    },
  )
  const result: ServerBenchResult = {
    version: 1,
    env,
    items,
    failed: [...failed, ...profile.failed],
    profileModules: profile.modules,
  }
  await saveServerBench(result)
  return result
}
