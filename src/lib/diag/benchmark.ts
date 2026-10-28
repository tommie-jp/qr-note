// CPU ベンチマーク (7z b の MIPS)。サーバー情報の画面から押したときだけ走る。
//
// 1 回に 30 秒前後かかり CPU を使い切るので、画面を開くたびに集める
// collectServerInfo には混ぜない (節の制限 5 秒に収まらず、負荷も掛かる)。
// 同時に 2 本走らせると互いに遅くなり数字が嘘になるので、実行中は同じ結果を待たせる
import 'server-only'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { formatJstDateTime } from '../datetime'
import { errorText } from '../errorMessage'
import { safeErrorText } from './safeErrorText'
import { notesRepoDir } from '../git/notesRepo'

const execFileAsync = promisify(execFile)

// シングル 30 秒 + マルチ 30 秒に余裕を足した上限
const BENCH_TIMEOUT_MS = 180_000

export interface BenchmarkResult {
  singleMips: number
  multiMips: number
  threads: number
  // 本番と WSL を比べるとき、どの CPU の数字か分かるように一緒に残す
  cpuModel: string
  // ISO 8601。JSON に載せるので文字列
  measuredAt: string
}

// 結果の置き場。ノートの git リポジトリの作業ツリー直下 — 永続 volume に既に乗っており
// (compose の変更もデプロイ時の転送も要らない)、ノートの add / status は
// `notes` 配下に限っているので履歴にも bundle にも混ざらない。
// **.git の中には置かない**: openRepo は <dir>/.git の有無で「初期化済みか」を見るので、
// 先にディレクトリを作ると git init が飛ばされてリポジトリが壊れる
export function benchmarkFilePath(): string {
  return join(notesRepoDir(), 'qr-benchmark.json')
}

export function formatBenchmark(r: BenchmarkResult): string {
  return `シングル ${r.singleMips} MIPS / マルチ (${r.threads} スレッド) ${r.multiMips} MIPS — ${r.cpuModel}, ${formatJstDateTime(new Date(r.measuredAt))} 計測`
}

// 無ければ null (未計測)。壊れていたら投げる — 未計測と取り違えない
export async function readSavedBenchmark(path = benchmarkFilePath()): Promise<BenchmarkResult | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  const v = JSON.parse(text) as Partial<BenchmarkResult>
  if (typeof v.singleMips !== 'number' || typeof v.multiMips !== 'number' || typeof v.threads !== 'number' || typeof v.cpuModel !== 'string' || typeof v.measuredAt !== 'string') {
    throw new Error(`${path} の形が不正`)
  }
  return v as BenchmarkResult
}

async function saveBenchmark(r: BenchmarkResult, path = benchmarkFilePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(r), 'utf8')
  await rename(tmp, path)
}

// "Tot:  99  5894  5858" の最後の数が総合評価 (Rating MIPS)
export function parseTotalMips(output: string): number {
  const line = output.split('\n').find((l) => l.startsWith('Tot:'))
  const last = line?.trim().split(/\s+/).at(-1)
  const mips = Number(last)
  if (!Number.isFinite(mips) || mips <= 0) {
    throw new Error('7z b の出力から Tot: の MIPS を読めなかった')
  }
  return mips
}

async function run7z(args: string[]): Promise<number> {
  const { stdout } = await execFileAsync('7z', ['b', ...args], {
    timeout: BENCH_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })
  return parseTotalMips(stdout)
}

async function measure(threads: number): Promise<BenchmarkResult> {
  const singleMips = await run7z(['-mmt1'])
  const multiMips = await run7z([`-mmt${threads}`])
  const result = {
    singleMips,
    multiMips,
    threads,
    cpuModel: os.cpus()[0]?.model.trim() ?? '不明',
    measuredAt: new Date().toISOString(),
  }
  await saveBenchmark(result)
  return result
}

let running: Promise<void> | null = null
let lastError: string | null = null

// 計測を裏で始める (走っていれば何もしない)。結果は待たない — 1 分前後かかり、
// リクエストに乗せたままだと nginx の応答待ち (既定 60 秒) に切られて
// 「An unexpected response was received」になる。画面は benchmarkProgress を
// 引いて終わりを知り、結果は保存ファイルから読む
export function startBenchmark(threads: number): void {
  if (running) {
    return
  }
  lastError = null
  running = measure(threads)
    .then(
      () => undefined,
      (error: unknown) => {
        // 画面には理由を出し、/logs にも残す (黙って終わらせない)
        console.warn('CPU 計測に失敗', error instanceof Error ? error : new Error(errorText(error)))
        lastError = safeErrorText(error)
      },
    )
    .finally(() => {
      running = null
    })
}

export function benchmarkProgress(): { running: boolean; error: string | null } {
  return { running: running !== null, error: lastError }
}
