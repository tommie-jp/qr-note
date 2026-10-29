// QR-Note ベンチマークの保存 (docs/121 §2)。
//
// 置き場は benchmark.ts (7z b) と同じ、ノートの git リポジトリの作業ツリー直下。
// 永続 volume に乗っていて、ノートの add / status は `notes` 配下に限っている
// ので履歴にも bundle にも混ざらない。**.git の中には置かない** (benchmark.ts の
// benchmarkFilePath を参照)。
//
// 読みは「無ければ null、壊れていれば投げる」(未計測と取り違えない)。
// 書きは tmp に書いて rename (読み手が書きかけを見ない)
import 'server-only'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { notesRepoDir } from '../git/notesRepo'
import type { ClientBenchRun, ServerBenchResult } from './benchTypes'

export const serverBenchPath = (): string => join(notesRepoDir(), 'qr-benchmark-server.json')
export const clientBenchPath = (): string => join(notesRepoDir(), 'qr-benchmark-client.json')
export const profilePath = (): string => join(notesRepoDir(), 'qr-benchmark-parse.cpuprofile')

export async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // 同時に 2 本書いても tmp がぶつからないよう名前を分ける
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

async function readJson(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  return JSON.parse(text)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isServerBenchResult(value: unknown): value is ServerBenchResult {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.env) || !Array.isArray(value.items)) {
    return false
  }
  const env = value.env
  return (
    typeof env.cpuModel === 'string' &&
    typeof env.measuredAt === 'string' &&
    Array.isArray(value.failed) &&
    value.items.every(
      (item) => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.medianMs === 'number' && isRecord(item.phases),
    )
  )
}

export function isClientBenchRun(value: unknown): value is ClientBenchRun {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.device === 'string' &&
    typeof value.line === 'string' &&
    typeof value.measuredAt === 'string' &&
    Array.isArray(value.rows) &&
    value.rows.every((row) => isRecord(row) && typeof row.label === 'string' && typeof row.value === 'string')
  )
}

export async function readServerBench(path = serverBenchPath()): Promise<ServerBenchResult | null> {
  const value = await readJson(path)
  if (value === null) {
    return null
  }
  if (!isServerBenchResult(value)) {
    throw new Error(`${path} の形が不正`)
  }
  return value
}

export async function saveServerBench(result: ServerBenchResult, path = serverBenchPath()): Promise<void> {
  await writeAtomic(path, JSON.stringify(result))
}

// 端末 × 回線ごとに最新 1 回。鍵は `${device}/${line}`
export async function readClientBenches(path = clientBenchPath()): Promise<Record<string, ClientBenchRun>> {
  const value = await readJson(path)
  if (value === null) {
    return {}
  }
  if (!isRecord(value) || !Object.values(value).every(isClientBenchRun)) {
    throw new Error(`${path} の形が不正`)
  }
  return value as Record<string, ClientBenchRun>
}

export const clientBenchKey = (run: Pick<ClientBenchRun, 'device' | 'line'>): string => `${run.device}/${run.line}`

// 読んで書くので、2 台が同時に完了すると片方の結果が消える。1 本ずつ流す
let clientSaveChain: Promise<void> = Promise.resolve()

// 同じ鍵は上書きする。読めない (壊れた) ファイルは投げる — 黙って上書きすると
// 他の端末の結果まで消える
export function saveClientBench(run: ClientBenchRun, path = clientBenchPath()): Promise<void> {
  const next = clientSaveChain.then(async () => {
    const current = await readClientBenches(path)
    await writeAtomic(path, JSON.stringify({ ...current, [clientBenchKey(run)]: run }))
  })
  // 失敗しても次の保存は流す (失敗は呼んだ側へ返す)
  clientSaveChain = next.catch(() => undefined)
  return next
}

// cpuprofile の取得日時。無ければ null
export async function profileSavedAt(path = profilePath()): Promise<string | null> {
  try {
    return (await stat(path)).mtime.toISOString()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}
