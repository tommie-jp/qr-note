// QR-Note 本体の節 (docs/109-サーバー情報計画.md §3)。
//
// 版・ランタイム・起動時刻・プロセスのメモリ・データ領域の空き、そして
// 外部連携の設定。**env の値そのものは出さない** — あり / なしの真偽だけ。
// 管理者限定の画面でもスクショ・共有で漏れる (docs/109 §2)。
//
// 読み口は AppProbe に寄せてテストから差し替える。本物は nodeAppProbe
import 'server-only'
import { access, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import nextPkg from 'next/package.json'
import pkg from '../../../package.json'
import { Prisma } from '@/generated/prisma/client'
import { appEnvEnv, isDemoMode, rakutenBooksEnv, webauthnEnv, yahooShoppingAppIdEnv } from '../appEnv'
import { formatJstDateTime } from '../datetime'
import { notesRepoDir } from '../git/notesRepo'
import { recentLogs } from '../logging/buffer'
import { formatBytes, formatDuration, formatPercent } from '../formatBytes'
import type { DiskInfo, GitRepoHealth } from './healthChecks'
import { safeErrorText } from './safeErrorText'
import type { InfoRow, InfoSection } from './types'

export interface AppProbe {
  version: string
  nodeVersion: string
  nextVersion: string
  prismaVersion: string
  appEnv: string | undefined
  isDemo: boolean
  processUptimeSeconds: number
  now(): Date
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number }
  timeZone: string
  // ノートの git 置き場。データ領域の空きはこの場所で statfs する
  dataDir: string
  statfs(path: string): Promise<DiskInfo>
  // 置き場の状態。.git がまだ無ければ 'uninitialized' (notesRepo が初回の書き込みで
  // init する)、あって HEAD が読めなければ投げる
  gitRepoState(dir: string): Promise<'ready' | 'uninitialized'>
  hasYahoo: boolean
  // 楽天の 3 つのうち設定されている数
  rakutenSet: number
  // パスキーの 2 つのうち設定されている数
  webauthnSet: number
  errorLogCount: number
}

const MS_PER_SECOND = 1000

function countSet(values: readonly (string | undefined)[]): number {
  return values.filter((v) => v !== undefined && v !== '').length
}

function nodeAppProbe(): AppProbe {
  const rakuten = rakutenBooksEnv()
  const webauthn = webauthnEnv()
  const dataDir = notesRepoDir()
  return {
    version: pkg.version,
    nodeVersion: process.version,
    nextVersion: nextPkg.version,
    prismaVersion: Prisma.prismaVersion.client,
    appEnv: appEnvEnv(),
    isDemo: isDemoMode(),
    processUptimeSeconds: process.uptime(),
    now: () => new Date(),
    memoryUsage: () => process.memoryUsage(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dataDir,
    statfs: async (path) => {
      const stats = await statfs(path)
      return { totalBytes: stats.bsize * stats.blocks, freeBytes: stats.bsize * stats.bavail }
    },
    gitRepoState: async (dir) => {
      const hasGitDir = await access(join(dir, '.git')).then(
        () => true,
        () => false,
      )
      if (!hasGitDir) {
        return 'uninitialized'
      }
      await access(join(dir, '.git', 'HEAD'))
      return 'ready'
    },
    hasYahoo: countSet([yahooShoppingAppIdEnv()]) === 1,
    rakutenSet: countSet([rakuten.appId, rakuten.accessKey, rakuten.origin]),
    webauthnSet: countSet([webauthn.rpId, webauthn.origin]),
    errorLogCount: recentLogs().filter((e) => e.source === 'server' && e.level === 'error').length,
  }
}

export interface AppInfo {
  section: InfoSection
  // 以下はヘルスチェック (healthChecks.ts) へ渡す
  disk: DiskInfo | null
  gitRepo: GitRepoHealth
  errorLogCount: number
  rakutenSet: number
  webauthnSet: number
}

function presence(set: number, total: number): string {
  if (set === 0) {
    return '未設定'
  }
  return set === total ? `設定あり (${set}/${total})` : `一部だけ (${set}/${total})`
}

function startedRow(probe: AppProbe): InfoRow {
  const startedAt = new Date(probe.now().getTime() - probe.processUptimeSeconds * MS_PER_SECOND)
  return {
    label: '起動',
    value: `${formatJstDateTime(startedAt)} (${formatDuration(probe.processUptimeSeconds)} 前)`,
  }
}

function dataDirRow(dataDir: string, disk: DiskInfo | null, diskError: string | null): InfoRow {
  const usage =
    disk === null
      ? `不明 (${diskError ?? '読めない'})`
      : `空き ${formatBytes(disk.freeBytes)} / ${formatBytes(disk.totalBytes)} (${formatPercent(disk.freeBytes, disk.totalBytes)})`
  return { label: 'データ領域', value: `${dataDir} — ${usage}` }
}

export async function collectAppInfo(probe: AppProbe = nodeAppProbe()): Promise<AppInfo> {
  let disk: DiskInfo | null = null
  let diskError: string | null = null
  try {
    disk = await probe.statfs(probe.dataDir)
  } catch (error) {
    diskError = safeErrorText(error)
  }
  let gitRepo: GitRepoHealth
  try {
    gitRepo = (await probe.gitRepoState(probe.dataDir)) === 'ready' ? { kind: 'ok' } : { kind: 'uninitialized' }
  } catch (error) {
    gitRepo = { kind: 'failed', message: safeErrorText(error) }
  }

  const memory = probe.memoryUsage()
  const rows: InfoRow[] = [
    { label: '版', value: probe.version },
    { label: 'Node.js', value: probe.nodeVersion },
    { label: 'Next.js', value: probe.nextVersion },
    { label: 'Prisma', value: probe.prismaVersion },
    { label: 'APP_ENV', value: probe.appEnv === undefined || probe.appEnv === '' ? '(未設定)' : probe.appEnv },
    { label: 'デモモード', value: probe.isDemo ? 'はい' : 'いいえ' },
    startedRow(probe),
    {
      label: 'プロセスのメモリ',
      value: `RSS ${formatBytes(memory.rss)} / ヒープ ${formatBytes(memory.heapUsed)} (確保 ${formatBytes(memory.heapTotal)})`,
    },
    { label: 'タイムゾーン', value: probe.timeZone },
    dataDirRow(probe.dataDir, disk, diskError),
    { label: 'Yahoo!ショッピング', value: probe.hasYahoo ? '設定あり' : '未設定' },
    { label: '楽天ブックス', value: presence(probe.rakutenSet, 3) },
    { label: 'パスキー', value: presence(probe.webauthnSet, 2) },
  ]
  return {
    section: { id: 'app', title: 'QR-Note', result: { kind: 'ok', rows } },
    disk,
    gitRepo,
    errorLogCount: probe.errorLogCount,
    rakutenSet: probe.rakutenSet,
    webauthnSet: probe.webauthnSet,
  }
}
