// ホストとコンテナの節 (docs/109-サーバー情報計画.md §3)。
//
// アプリは node:24-slim のコンテナに居る。カーネルは共有なので os モジュールと
// /proc はホストの値を返すが、/etc/os-release とホスト名はコンテナのもの。
// 混ぜて 1 つの「サーバ」にせず、ホストとコンテナの 2 節に分けて正直に出す。
//
// ホストの OS 名とホスト名は compose が /etc/os-release と /etc/hostname を
// HOST_OS_RELEASE_PATH / HOST_HOSTNAME_PATH に
// read-only でマウントしてくれる前提。無ければその行だけ不明にして、
// マウント漏れだと分かる文言にする (節ごと落とさない)。
//
// 読み口は HostProbe に寄せてテストから差し替える。本物は nodeHostProbe
import 'server-only'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { safeErrorText } from './safeErrorText'
import { formatBytes, formatDuration, formatPercent } from '../formatBytes'
import { osPrettyName } from './osRelease'
import { type MemInfo, parseMeminfo } from './procMeminfo'
import type { InfoRow, InfoSection } from './types'

export const HOST_OS_RELEASE_PATH = '/host/os-release'
// os.hostname() はコンテナ ID を返すので、ホストの名前はマウントして読む
export const HOST_HOSTNAME_PATH = '/host/hostname'
export const CONTAINER_OS_RELEASE_PATH = '/etc/os-release'
export const MEMINFO_PATH = '/proc/meminfo'
// cgroup v2。v1 (memory.limit_in_bytes) は見ない — Docker 20.10 以降の
// 既定は v2 で、vps2 もそう
export const CGROUP_MEMORY_MAX_PATH = '/sys/fs/cgroup/memory.max'

export interface HostProbe {
  readText(path: string): Promise<string>
  kernel(): string
  arch(): string
  uptimeSeconds(): number
  loadavg(): number[]
  cpuCount(): number
  hostname(): string
}

const nodeHostProbe: HostProbe = {
  readText: (path) => readFile(path, 'utf8'),
  kernel: () => os.release(),
  arch: () => os.arch(),
  uptimeSeconds: () => os.uptime(),
  loadavg: () => os.loadavg(),
  cpuCount: () => os.cpus().length,
  hostname: () => os.hostname(),
}

export interface HostInfo {
  sections: InfoSection[]
  // ヘルスチェック (healthChecks.ts) へ渡す。読めなければ null
  memory: MemInfo | null
}

const UNKNOWN = '不明'

// 読めなければ null。理由は呼ぶ側が行の文言に組む
async function readOptional(probe: HostProbe, path: string): Promise<string | null> {
  try {
    return await probe.readText(path)
  } catch {
    return null
  }
}

async function readOsName(probe: HostProbe, path: string): Promise<string | null> {
  const text = await readOptional(probe, path)
  return text === null ? null : osPrettyName(text)
}

function memoryRows(memory: MemInfo | null): InfoRow[] {
  if (memory === null) {
    return [{ label: 'メモリ', value: `${UNKNOWN} (${MEMINFO_PATH} が読めない)` }]
  }
  const swapUsed = memory.swapTotalBytes - memory.swapFreeBytes
  return [
    {
      label: 'メモリ',
      value: `利用可能 ${formatBytes(memory.availableBytes)} / ${formatBytes(memory.totalBytes)} (${formatPercent(memory.availableBytes, memory.totalBytes)})`,
    },
    {
      label: 'スワップ',
      value:
        memory.swapTotalBytes === 0
          ? '無し'
          : `使用 ${formatBytes(swapUsed)} / ${formatBytes(memory.swapTotalBytes)} (${formatPercent(swapUsed, memory.swapTotalBytes)})`,
    },
  ]
}

async function hostSection(probe: HostProbe): Promise<{ section: InfoSection; memory: MemInfo | null }> {
  const osName = await readOsName(probe, HOST_OS_RELEASE_PATH)
  const hostname = (await readOptional(probe, HOST_HOSTNAME_PATH))?.trim() || null
  const meminfo = await readOptional(probe, MEMINFO_PATH)
  const memory = meminfo === null ? null : parseMeminfo(meminfo)
  const rows: InfoRow[] = [
    {
      label: 'ホスト名',
      value: hostname ?? `${UNKNOWN} (${HOST_HOSTNAME_PATH} が無い — compose のマウントを確認)`,
    },
    {
      label: 'OS',
      value: osName ?? `${UNKNOWN} (${HOST_OS_RELEASE_PATH} が無い — compose のマウントを確認)`,
    },
    { label: 'カーネル', value: `${probe.kernel()} (${probe.arch()})` },
    { label: '稼働時間', value: formatDuration(probe.uptimeSeconds()) },
    {
      label: 'ロードアベレージ',
      value: probe
        .loadavg()
        .map((v) => v.toFixed(2))
        .join(' / '),
    },
    { label: 'CPU', value: `${probe.cpuCount()} コア` },
    ...memoryRows(memory),
  ]
  return { section: { id: 'host', title: 'ホスト', result: { kind: 'ok', rows } }, memory }
}

// cgroup v2 の memory.max は上限のバイト数か "max" (無制限)
function formatCgroupLimit(text: string | null): string {
  if (text === null) {
    return `${UNKNOWN} (${CGROUP_MEMORY_MAX_PATH} が読めない)`
  }
  const trimmed = text.trim()
  if (trimmed === 'max') {
    return '無制限'
  }
  const bytes = Number(trimmed)
  return Number.isFinite(bytes) ? formatBytes(bytes) : `${UNKNOWN} (${trimmed})`
}

async function containerSection(probe: HostProbe): Promise<InfoSection> {
  const osName = await readOsName(probe, CONTAINER_OS_RELEASE_PATH)
  const limit = await readOptional(probe, CGROUP_MEMORY_MAX_PATH)
  const rows: InfoRow[] = [
    { label: 'OS', value: osName ?? UNKNOWN },
    { label: 'ホスト名 (コンテナ ID)', value: probe.hostname() },
    { label: 'メモリ上限 (cgroup)', value: formatCgroupLimit(limit) },
  ]
  return { id: 'container', title: 'コンテナ', result: { kind: 'ok', rows } }
}

export async function collectHostInfo(probe: HostProbe = nodeHostProbe): Promise<HostInfo> {
  try {
    const [{ section: host, memory }, container] = await Promise.all([
      hostSection(probe),
      containerSection(probe),
    ])
    return { sections: [host, container], memory }
  } catch (error) {
    // os.* が投げることは無いはずだが、投げたら節ごと失敗にして理由を残す
    const message = safeErrorText(error)
    const failed = { kind: 'failed', message } as const
    return {
      sections: [
        { id: 'host', title: 'ホスト', result: failed },
        { id: 'container', title: 'コンテナ', result: failed },
      ],
      memory: null,
    }
  }
}
