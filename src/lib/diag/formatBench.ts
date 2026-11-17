// ベンチマークの表示とコピーの整形 (docs/121 §1)。
//
// コピーは `key=値` の 1 行 1 項目 (docs/119 §1-1 と同じ流儀)。WSL・本番・
// 移行先の 3 枚を貼り並べて、行ごとに差を読む。状態を持たない葉
import { formatJstDateTime, formatJstDateTimeAgo } from '../datetime'
import type {
  BenchEnv,
  ClientBenchRun,
  ContainerStat,
  FreeMem,
  HostSnapshot,
  MemoryDelta,
  MemoryRound,
  ServerBenchItem,
  ServerBenchResult,
} from './benchTypes'

export function formatMs(ms: number): string {
  return ms >= 100 ? `${Math.round(ms)}ms` : `${ms.toFixed(1)}ms`
}

export function formatPhases(phases: Readonly<Record<string, number>>): string {
  return Object.entries(phases)
    .map(([name, ms]) => `${name}=${formatMs(ms)}`)
    .join(' ')
}

// 古い保存 (v0.23.143 以前) には無い行。読めなかった値は「不明」と書く
function machineRows(env: BenchEnv): { label: string; value: string }[] {
  if (env.kernel === undefined) {
    return []
  }
  return [
    { label: 'ホスト名', value: env.hostName ?? '不明' },
    { label: 'OS', value: `${env.osName ?? '不明'} (カーネル ${env.kernel})` },
  ]
}

// now を渡すと計測の日時に「(5分前)」を添える (画面用。コピーは貼った先で古びるので付けない)
export function envRows(env: BenchEnv, now: Date | null = null): { label: string; value: string }[] {
  return [
    ...machineRows(env),
    { label: 'CPU', value: `${env.cpuModel} (${env.threads} スレッド)` },
    { label: 'メモリ', value: `${env.totalMemMB}MB` },
    { label: '版', value: `QR-Note ${env.appVersion} / Node.js ${env.nodeVersion}` },
    { label: 'ノート', value: `${env.items} 件 (回路 ${env.circuitItems} 件)` },
    { label: '計測', value: formatJstDateTimeAgo(new Date(env.measuredAt), now) },
  ]
}

const signedMB = (mb: number): string => `${mb >= 0 ? '+' : ''}${mb}MB`
const mb0 = (mb: number): string => `${Math.round(mb)}MB`

// 項目の前後の差 (docs/127 §2)。GC の時機に揺れるので目安
export function formatMemoryDelta(delta: MemoryDelta): string {
  return [
    `rss=${Math.round(delta.rssBeforeMB)}→${mb0(delta.rssAfterMB)}`,
    `heap=${signedMB(delta.heapUsedDeltaMB)}`,
    `ext=${signedMB(delta.externalDeltaMB)}`,
    `最大rss=${signedMB(delta.maxRssGrowthMB)}`,
  ].join(' ')
}

// 周回の 1 点。cgroup (コンテナ全体) は読めた環境でだけ書く
export function formatMemoryRound(round: MemoryRound, cgroupMaxMB: number | null): string {
  const m = round.memory
  const notes = [
    m.cgroupPeakMB === null ? '' : `ピーク ${mb0(m.cgroupPeakMB)}`,
    cgroupMaxMB === null ? '' : `上限 ${mb0(cgroupMaxMB)}`,
  ].filter((part) => part !== '')
  const cgroup =
    m.cgroupCurrentMB === null
      ? ''
      : `cgroup ${mb0(m.cgroupCurrentMB)}${notes.length > 0 ? ` (${notes.join(' / ')})` : ''}`
  return [
    `メモリ.${round.label}=rss ${mb0(m.rssMB)}`,
    `heap ${Math.round(m.heapUsedMB)}/${mb0(m.heapTotalMB)}`,
    `ext ${mb0(m.externalMB)}`,
    `最大rss ${mb0(m.maxRssMB)}`,
    cgroup,
    `起動 ${m.uptimeSec}秒`,
  ]
    .filter((part) => part !== '')
    .join(' ')
}

// docker stats と同じ書き方 (1GiB 未満は MiB、以上は GiB)
export function formatMiB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}GiB` : `${mb.toFixed(1)}MiB`
}

// free -m の表の行 (見出し・Mem・Swap)。列は free と同じ並び
export function freeMemTable(mem: FreeMem): { head: string[]; rows: { label: string; cells: number[] }[] } {
  return {
    head: ['total', 'used', 'free', 'shared', 'buff/cache', 'available'],
    rows: [
      {
        label: 'Mem',
        cells: [mem.totalMB, mem.usedMB, mem.freeMB, mem.sharedMB, mem.buffCacheMB, mem.availableMB],
      },
      { label: 'Swap', cells: [mem.swapTotalMB, mem.swapUsedMB, mem.swapFreeMB] },
    ],
  }
}

export function containerLabel(stat: ContainerStat): string {
  const name = stat.name ?? stat.id
  return stat.isSelf ? `${name} (このアプリ)` : name
}

export function formatCpuPercent(stat: ContainerStat): string {
  return stat.cpuPercent === null ? '不明' : `${stat.cpuPercent.toFixed(2)}%`
}

export function formatMemUsage(stat: ContainerStat): string {
  const pct = stat.memLimitMB > 0 ? ` (${((stat.memUsageMB / stat.memLimitMB) * 100).toFixed(2)}%)` : ''
  return `${formatMiB(stat.memUsageMB)} / ${formatMiB(stat.memLimitMB)}${pct}`
}

export function hostLines(host: HostSnapshot): string[] {
  const table = host.freeMem ? freeMemTable(host.freeMem) : null
  const free = (table?.rows ?? []).map((row) => {
    const cells = row.cells.map((value, col) => `${table?.head[col]} ${value}`).join(' ')
    return `ホスト.${row.label}=${cells} (MiB)`
  })
  return [
    `ホスト.取得=${formatJstDateTime(new Date(host.takenAt))} (計測前)`,
    ...free,
    ...host.containers.map(
      (stat) =>
        `コンテナ.${containerLabel(stat)}=CPU ${formatCpuPercent(stat)} MEM ${formatMemUsage(stat)} PIDS ${stat.pids ?? '不明'}`,
    ),
    ...host.notes.map((note) => `ホスト.注意=${note}`),
  ]
}

function serverItemLine(item: ServerBenchItem): string {
  const phases = formatPhases(item.phases)
  return [
    `サーバ.${item.id}=${formatMs(item.medianMs)}`,
    `規模=${item.scale}`,
    item.fixed ? '固定' : '',
    phases,
    item.memory ? formatMemoryDelta(item.memory) : '',
  ]
    .filter((part) => part !== '')
    .join(' ')
}

function clientLines(run: ClientBenchRun): string[] {
  const head = `端末.${run.device}/${run.line}`
  return [
    `${head} panes=${run.panes} 幅=${run.width} 計測=${formatJstDateTime(new Date(run.measuredAt))}`,
    ...run.rows.map((row) => `${head}.${row.label}=${row.value}`),
  ]
}

export function formatBenchCopy(input: {
  cpu: string | null
  server: ServerBenchResult | null
  clients: readonly ClientBenchRun[]
}): string {
  const lines = [
    '## QR-Note ベンチマーク',
    ...(input.server ? envRows(input.server.env).map((row) => `環境.${row.label}=${row.value}`) : ['環境=未計測']),
    `CPU.7z=${input.cpu ?? '未計測'}`,
    ...(input.server
      ? [
          ...input.server.items.map(serverItemLine),
          ...input.server.failed.map((f) => `サーバ.${f.id}=失敗 (${f.message})`),
          ...(input.server.profileModules ?? []).map((m) => `解析.${m.module}=${formatMs(m.ms)} ${m.pct}%`),
          ...(input.server.memoryRounds ?? []).map((round) =>
            formatMemoryRound(round, input.server?.cgroupMaxMB ?? null),
          ),
          ...(input.server.host ? hostLines(input.server.host) : []),
        ]
      : ['サーバ=未計測']),
    ...(input.clients.length > 0 ? input.clients.flatMap(clientLines) : ['端末=未計測']),
  ]
  return lines.join('\n')
}
