// /proc/meminfo を free -m の列に組む (ベンチマークのホストの節)。
//
// コンテナの中でもカーネルは共有なので、/proc/meminfo はホストの値
// (procMeminfo.ts と同じ前提)。列の定義は procps-ng 4 の free に合わせる:
//   used       = MemTotal − MemAvailable
//   buff/cache = Buffers + Cached + SReclaimable
//   shared     = Shmem
// MiB への丸めは free -m と同じく切り捨て。状態を持たない葉
import type { FreeMem } from './benchTypes'

const KB_PER_MB = 1024

function readKb(text: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB\\s*$`, 'm').exec(text)
  return match ? Number(match[1]) : null
}

const toMB = (kb: number): number => Math.floor(kb / KB_PER_MB)

// MemTotal・MemAvailable・MemFree が揃わなければ null (半端な表を出さない)
export function parseFreeMem(meminfo: string): FreeMem | null {
  const total = readKb(meminfo, 'MemTotal')
  const available = readKb(meminfo, 'MemAvailable')
  const free = readKb(meminfo, 'MemFree')
  if (total === null || available === null || free === null) {
    return null
  }
  const optional = (key: string): number => readKb(meminfo, key) ?? 0
  const swapTotal = optional('SwapTotal')
  const swapFree = optional('SwapFree')
  return {
    totalMB: toMB(total),
    usedMB: toMB(total - available),
    freeMB: toMB(free),
    sharedMB: toMB(optional('Shmem')),
    buffCacheMB: toMB(optional('Buffers') + optional('Cached') + optional('SReclaimable')),
    availableMB: toMB(available),
    swapTotalMB: toMB(swapTotal),
    swapUsedMB: toMB(swapTotal - swapFree),
    swapFreeMB: toMB(swapFree),
  }
}
