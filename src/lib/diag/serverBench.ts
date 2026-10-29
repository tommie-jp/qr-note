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
import { gzipSync } from 'node:zlib'
import sharp from 'sharp'
import pkg from '../../../package.json'
import { prisma } from '@/lib/db'
import { makeThumbnail } from '@/lib/images/thumbnail'
import { searchItems } from '@/lib/items/search'
import { loadOfflineSyncPayload } from '@/lib/offline/syncItems'
import { safeErrorText } from './safeErrorText'
import { BENCH_FIXTURE_MD } from './benchFixture'
import { profileCpu } from './benchProfile'
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
      label: `回路の解析 (実ノート ${COLD_PARSE_ITEMS} 件・記憶なし)`,
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
// 通るので、ならしの後は db・json・gzip の重さになる (普段の同期と同じ形)
const syncTask: BenchTask = {
  id: 'sync:payload',
  label: '同期の組み立て (db → json → gzip)',
  fixed: false,
  run: async () => {
    const db = await elapsed(() => loadOfflineSyncPayload())
    const t0 = performance.now()
    const json = JSON.stringify(db.value)
    const t1 = performance.now()
    const gz = gzipSync(json)
    const t2 = performance.now()
    const mb = (bytes: number) => (bytes / MB).toFixed(1)
    return {
      totalMs: db.ms + (t2 - t0),
      phases: { db: db.ms, json: t1 - t0, gzip: t2 - t1 },
      scale: `${db.value.items.length} 件・${mb(Buffer.byteLength(json))}MB → ${mb(gz.byteLength)}MB`,
    }
  },
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
// (プロファイラの負担で遅くなる)
async function saveParseProfile(coldMemos: readonly string[]): Promise<void> {
  const memos = coldMemos.length > 0 ? coldMemos : [BENCH_FIXTURE_MD]
  const { profile } = await profileCpu(() => parseBatch(memos))
  await writeAtomic(profilePath(), JSON.stringify(profile))
}

export async function runServerBench(): Promise<ServerBenchResult> {
  const env = await collectBenchEnv()
  const coldMemos = await loadColdMemos()
  const jpeg = await makeNoiseJpeg()
  const tasks: BenchTask[] = [
    ...searchTasks(),
    // 回路ノートが 1 件も無い DB (新しい移行先など) では実ノートの行を飛ばす
    ...parseTasks(coldMemos).filter((task) => coldMemos.length > 0 || task.fixed),
    thumbTask(jpeg),
    syncTask,
  ]
  const { items, failed } = await runTasks(tasks)
  const profileFailed = await saveParseProfile(coldMemos).then(
    () => [],
    (error: unknown) => {
      console.warn('サーバ側ベンチ: プロファイルの保存に失敗', error)
      return [{ id: 'profile', message: safeErrorText(error) }]
    },
  )
  const result: ServerBenchResult = { version: 1, env, items, failed: [...failed, ...profileFailed] }
  await saveServerBench(result)
  return result
}
