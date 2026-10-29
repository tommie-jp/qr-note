// ベンチマークの表示とコピーの整形 (docs/121 §1)。
//
// コピーは `key=値` の 1 行 1 項目 (docs/119 §1-1 と同じ流儀)。WSL・本番・
// 移行先の 3 枚を貼り並べて、行ごとに差を読む。状態を持たない葉
import { formatJstDateTime } from '../datetime'
import type { BenchEnv, ClientBenchRun, ServerBenchItem, ServerBenchResult } from './benchTypes'

export function formatMs(ms: number): string {
  return ms >= 100 ? `${Math.round(ms)}ms` : `${ms.toFixed(1)}ms`
}

export function formatPhases(phases: Readonly<Record<string, number>>): string {
  return Object.entries(phases)
    .map(([name, ms]) => `${name}=${formatMs(ms)}`)
    .join(' ')
}

export function envRows(env: BenchEnv): { label: string; value: string }[] {
  return [
    { label: 'CPU', value: `${env.cpuModel} (${env.threads} スレッド)` },
    { label: 'メモリ', value: `${env.totalMemMB}MB` },
    { label: '版', value: `QR-Note ${env.appVersion} / Node.js ${env.nodeVersion}` },
    { label: 'ノート', value: `${env.items} 件 (回路 ${env.circuitItems} 件)` },
    { label: '計測', value: formatJstDateTime(new Date(env.measuredAt)) },
  ]
}

function serverItemLine(item: ServerBenchItem): string {
  const phases = formatPhases(item.phases)
  return [
    `サーバ.${item.id}=${formatMs(item.medianMs)}`,
    `規模=${item.scale}`,
    item.fixed ? '固定' : '',
    phases,
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
        ]
      : ['サーバ=未計測']),
    ...(input.clients.length > 0 ? input.clients.flatMap(clientLines) : ['端末=未計測']),
  ]
  return lines.join('\n')
}
