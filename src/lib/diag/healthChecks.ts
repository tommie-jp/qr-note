// ヘルスチェックの判定 (docs/109-サーバー情報計画.md §4)。
//
// 「見て判断する」のではなく判定まで機械にやらせる行。入力は収集済みの値で、
// ここでは I/O をしない (収集は hostInfo / appInfo / dbInfo、組み立ては
// serverInfo.ts)。閾値は全部ここの定数 — 画面にもコピーにも同じ判定が出る。
//
// 「取れなかった」は OK に見せない。DB に届かなければ DB 由来の行は全部
// 異常、メモリやディスクが読めなければ注意にする。不明を緑で塗ると、
// 一番見たいときに一番役に立たない画面になる
import { formatBytes, formatPercent } from '../formatBytes'
import type { MemInfo } from './procMeminfo'
import type { HealthCheck, HealthLevel } from './types'

export interface DbHealthInputs {
  // SELECT 1 の往復 (ms)
  pingMs: number
  // pg_extension の pgroonga の版。無ければ null
  pgroongaVersion: string | null
  // pgroonga を使う索引の名前。0 本 = 全文検索が seq scan に落ちている
  pgroongaIndexes: string[]
  // _prisma_migrations で finished_at が null か rolled_back_at がある行の数
  brokenMigrations: number
}

export type DbHealth =
  | ({ kind: 'ok' } & DbHealthInputs)
  | { kind: 'failed'; message: string }

// uninitialized … .git がまだ無い。notesRepo は初回の書き込み時に init するので
// 正常 (配布直後・ローカルの空の data/ で「履歴が書けない」と嘘を言わない)
export type GitRepoHealth =
  | { kind: 'ok' }
  | { kind: 'uninitialized' }
  | { kind: 'failed'; message: string }

export interface DiskInfo {
  totalBytes: number
  freeBytes: number
}

export interface HealthInputs {
  db: DbHealth
  gitRepo: GitRepoHealth
  // null = /proc/meminfo が読めなかった
  memory: MemInfo | null
  // null = statfs が失敗した
  disk: DiskInfo | null
  // 直近のサーバログ (リングバッファ) の error の件数
  errorLogCount: number
  // 楽天の 3 つ (appId / accessKey / origin) のうち設定されている数
  rakutenSet: number
  // パスキーの 2 つ (rpId / origin) のうち設定されている数
  webauthnSet: number
}

// 閾値 (§4 の表)
export const DB_PING_WARN_MS = 200
export const MEMORY_AVAILABLE_WARN_RATIO = 0.15
export const SWAP_USED_WARN_RATIO = 0.5
export const DISK_FREE_WARN_RATIO = 0.1
const RAKUTEN_KEY_COUNT = 3
const WEBAUTHN_KEY_COUNT = 2

const LEVEL_RANK: Readonly<Record<HealthLevel, number>> = { ok: 0, warn: 1, error: 2 }

export function overallLevel(checks: readonly HealthCheck[]): HealthLevel {
  return checks.reduce<HealthLevel>(
    (worst, check) => (LEVEL_RANK[check.level] > LEVEL_RANK[worst] ? check.level : worst),
    'ok',
  )
}

export function evaluateHealth(inputs: HealthInputs): HealthCheck[] {
  return [
    ...dbChecks(inputs.db),
    gitRepoCheck(inputs.gitRepo),
    memoryCheck(inputs.memory),
    swapCheck(inputs.memory),
    diskCheck(inputs.disk),
    errorLogCheck(inputs.errorLogCount),
    partialConfigCheck('楽天の設定', inputs.rakutenSet, RAKUTEN_KEY_COUNT),
    partialConfigCheck('パスキーの設定', inputs.webauthnSet, WEBAUTHN_KEY_COUNT),
  ]
}

const DB_CHECK_NAMES = ['DB 応答', 'PGroonga 拡張', 'PGroonga 索引', 'マイグレーション'] as const

function dbChecks(db: DbHealth): HealthCheck[] {
  if (db.kind === 'failed') {
    // 届かないときは 4 行とも異常。1 行目に理由、残りは「DB に届かないため不明」
    return DB_CHECK_NAMES.map((name, i) => ({
      name,
      level: 'error',
      detail: i === 0 ? `失敗: ${db.message}` : 'DB に届かないため不明',
    }))
  }
  return [
    {
      name: 'DB 応答',
      level: db.pingMs >= DB_PING_WARN_MS ? 'warn' : 'ok',
      detail: `SELECT 1 に ${db.pingMs}ms`,
    },
    db.pgroongaVersion === null
      ? { name: 'PGroonga 拡張', level: 'error', detail: '入っていない (全文検索が動かない)' }
      : { name: 'PGroonga 拡張', level: 'ok', detail: `版 ${db.pgroongaVersion}` },
    db.pgroongaIndexes.length === 0
      ? {
          name: 'PGroonga 索引',
          level: 'error',
          detail: '0 本 — 全文検索が seq scan に落ちている (migrate / createdb -T の後は REINDEX)',
        }
      : {
          name: 'PGroonga 索引',
          level: 'ok',
          detail: `${db.pgroongaIndexes.length} 本 (${db.pgroongaIndexes.join(', ')})`,
        },
    db.brokenMigrations > 0
      ? {
          name: 'マイグレーション',
          level: 'error',
          detail: `未完・巻き戻しが ${db.brokenMigrations} 件`,
        }
      : { name: 'マイグレーション', level: 'ok', detail: '未完・巻き戻しなし' },
  ]
}

function gitRepoCheck(repo: GitRepoHealth): HealthCheck {
  const name = 'ノートの git 置き場'
  switch (repo.kind) {
    case 'failed':
      return { name, level: 'warn', detail: `HEAD が読めない (履歴が書けない): ${repo.message}` }
    case 'uninitialized':
      return { name, level: 'ok', detail: '未初期化 (初回の履歴書き込み時に作成)' }
    default:
      return { name, level: 'ok', detail: 'HEAD が読める' }
  }
}

function memoryCheck(memory: MemInfo | null): HealthCheck {
  const name = 'メモリ (ホスト)'
  if (memory === null) {
    return { name, level: 'warn', detail: '/proc/meminfo が読めない' }
  }
  const ratio = memory.availableBytes / memory.totalBytes
  return {
    name,
    level: ratio < MEMORY_AVAILABLE_WARN_RATIO ? 'warn' : 'ok',
    detail: `利用可能 ${formatBytes(memory.availableBytes)} / ${formatBytes(memory.totalBytes)} (${formatPercent(memory.availableBytes, memory.totalBytes)})`,
  }
}

function swapCheck(memory: MemInfo | null): HealthCheck {
  const name = 'スワップ (ホスト)'
  if (memory === null) {
    return { name, level: 'warn', detail: '/proc/meminfo が読めない' }
  }
  if (memory.swapTotalBytes === 0) {
    return { name, level: 'ok', detail: 'スワップ無し' }
  }
  const used = memory.swapTotalBytes - memory.swapFreeBytes
  return {
    name,
    level: used / memory.swapTotalBytes >= SWAP_USED_WARN_RATIO ? 'warn' : 'ok',
    detail: `使用 ${formatBytes(used)} / ${formatBytes(memory.swapTotalBytes)} (${formatPercent(used, memory.swapTotalBytes)})`,
  }
}

function diskCheck(disk: DiskInfo | null): HealthCheck {
  const name = 'データ領域の空き'
  if (disk === null) {
    return { name, level: 'warn', detail: '空き容量が読めない' }
  }
  return {
    name,
    level: disk.freeBytes / disk.totalBytes < DISK_FREE_WARN_RATIO ? 'warn' : 'ok',
    detail: `空き ${formatBytes(disk.freeBytes)} / ${formatBytes(disk.totalBytes)} (${formatPercent(disk.freeBytes, disk.totalBytes)})`,
  }
}

function errorLogCheck(count: number): HealthCheck {
  return count > 0
    ? { name: '直近のサーバログ', level: 'warn', detail: `error が ${count} 件 (/logs で確認)` }
    : { name: '直近のサーバログ', level: 'ok', detail: 'error なし' }
}

// 「全部揃い」と「全部無し」は OK (使わない選択)。一部だけが設定ミス
function partialConfigCheck(name: string, set: number, total: number): HealthCheck {
  if (set === 0) {
    return { name, level: 'ok', detail: '未設定 (使わない)' }
  }
  if (set === total) {
    return { name, level: 'ok', detail: `${total} つ揃っている` }
  }
  return { name, level: 'warn', detail: `${total} つのうち ${set} つだけ設定されている` }
}
