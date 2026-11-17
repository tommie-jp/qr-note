// ベンチのメモリの記録 (docs/127-リファクタリング前プロファイル計画.md §2)。
//
// process.memoryUsage() はこのプロセスだけ。TeX の描画は子プロセスなので、
// コンテナ全体は cgroup v2 の memory.current / memory.peak で見る (本番の
// mem_limit 1600m までの余裕はこちらで読む)。手元の素の node では cgroup の
// ファイルがホスト全体を指すか読めないので、その値は参考にしない。
//
// 読み出しは probe に寄せてテストで差し替える。状態は持たない
import { readFile } from 'node:fs/promises'
import type { MemoryDelta, MemorySnapshot } from './benchTypes'

export const CGROUP_MEMORY_CURRENT_PATH = '/sys/fs/cgroup/memory.current'
export const CGROUP_MEMORY_PEAK_PATH = '/sys/fs/cgroup/memory.peak'

const MB = 1024 * 1024

export interface MemoryProbe {
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number }
  // process.resourceUsage().maxRSS (単位は kB)
  maxRssKB(): number
  // 読めなければ null (cgroup v1・手元の環境)
  readText(path: string): Promise<string | null>
  uptimeSec(): number
}

export const nodeMemoryProbe: MemoryProbe = {
  memoryUsage: () => process.memoryUsage(),
  maxRssKB: () => process.resourceUsage().maxRSS,
  readText: (path) => readFile(path, 'utf8').catch(() => null),
  uptimeSec: () => process.uptime(),
}

const toMB = (bytes: number): number => Math.round((bytes / MB) * 10) / 10

// memory.max・memory.current・memory.peak の中身。"max" (無制限) や読めない・
// 数字でない値は null
export function parseCgroupBytes(text: string | null): number | null {
  if (text === null) {
    return null
  }
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  return Number(trimmed)
}

const cgroupMB = async (probe: MemoryProbe, path: string): Promise<number | null> => {
  const bytes = parseCgroupBytes(await probe.readText(path))
  return bytes === null ? null : toMB(bytes)
}

export async function takeMemorySnapshot(probe: MemoryProbe = nodeMemoryProbe): Promise<MemorySnapshot> {
  const usage = probe.memoryUsage()
  const [cgroupCurrentMB, cgroupPeakMB] = await Promise.all([
    cgroupMB(probe, CGROUP_MEMORY_CURRENT_PATH),
    cgroupMB(probe, CGROUP_MEMORY_PEAK_PATH),
  ])
  return {
    rssMB: toMB(usage.rss),
    heapUsedMB: toMB(usage.heapUsed),
    heapTotalMB: toMB(usage.heapTotal),
    externalMB: toMB(usage.external),
    arrayBuffersMB: toMB(usage.arrayBuffers),
    maxRssMB: toMB(probe.maxRssKB() * 1024),
    cgroupCurrentMB,
    cgroupPeakMB,
    uptimeSec: Math.floor(probe.uptimeSec()),
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10

export function diffMemory(before: MemorySnapshot, after: MemorySnapshot): MemoryDelta {
  return {
    rssBeforeMB: before.rssMB,
    rssAfterMB: after.rssMB,
    heapUsedDeltaMB: round1(after.heapUsedMB - before.heapUsedMB),
    externalDeltaMB: round1(after.externalMB - before.externalMB),
    maxRssGrowthMB: round1(Math.max(0, after.maxRssMB - before.maxRssMB)),
  }
}
