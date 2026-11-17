// docker stats --no-stream 相当を、ホストの cgroup v2 から読む (ベンチマークの
// ホストの節)。
//
// アプリのコンテナに docker.sock は渡さない (root と同等になる。2026-11 の監査)。
// 代わりに compose がホストの /sys/fs/cgroup を read-only で HOST_CGROUP_ROOT に
// マウントする。各コンテナの cgroup は
//   systemd ドライバ: system.slice/docker-<64 桁>.scope
//   cgroupfs ドライバ: docker/<64 桁>
// にある。値の計算は docker CLI に合わせる:
//   MEM USAGE = memory.current − memory.stat の inactive_file
//   LIMIT     = memory.max (max ならホストの総メモリ)
//   CPU %     = 区間の usage_usec の増分 / 区間の長さ × 100 (1 コア = 100%)
//
// cgroup には名前が無いので、配布 (doDeploy.sh・doStart.sh) が docker ps で
// 書く「ID → 名前」の表を読む。表より後に作り直されたコンテナは名前が引けず、
// 短い ID のまま出す。読み口は ContainerProbe に寄せてテストから差し替える
import type { ContainerStat } from './benchTypes'
import { parseCgroupBytes } from './memorySample'

export const HOST_CGROUP_ROOT = '/host/cgroup'
export const CONTAINER_NAMES_PATH = '/host/info/containers.tsv'
// CPU % を出す区間 (docker stats --no-stream も 1 回の差分を取る)
export const CPU_SAMPLE_MS = 1000

const SHORT_ID_LENGTH = 12
const MB = 1024 * 1024
const FULL_ID = /^[0-9a-f]{64}$/

export interface ContainerProbe {
  // 無いディレクトリは投げる
  listDir(path: string): Promise<string[]>
  // 読めなければ null
  readText(path: string): Promise<string | null>
  sleep(ms: number): Promise<void>
  // 単調増加の ms (performance.now)
  nowMs(): number
  // このプロセスのホスト名 (docker では短いコンテナ ID)
  hostname(): string
}

interface ContainerDir {
  id: string
  dir: string
}

// `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}'` の出力を読む
export function parseContainerNames(text: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const line of text.split('\n')) {
    const [id, name] = line.trim().split('\t')
    if (id && name && FULL_ID.test(id)) {
      names.set(id, name)
    }
  }
  return names
}

// memory.stat の 1 項目 (バイト)。無ければ 0
export function readStatField(stat: string, key: string): number {
  const match = new RegExp(`^${key} (\\d+)$`, 'm').exec(stat)
  return match ? Number(match[1]) : 0
}

async function listOrEmpty(probe: ContainerProbe, path: string): Promise<string[]> {
  try {
    return await probe.listDir(path)
  } catch {
    return []
  }
}

// 両ドライバの置き場所を見て、動いているコンテナの cgroup を集める
export async function findContainerDirs(probe: ContainerProbe, root: string): Promise<ContainerDir[]> {
  const systemd = (await listOrEmpty(probe, `${root}/system.slice`))
    .map((entry) => /^docker-([0-9a-f]{64})\.scope$/.exec(entry))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ id: match[1] as string, dir: `${root}/system.slice/${match[0]}` }))
  const cgroupfs = (await listOrEmpty(probe, `${root}/docker`))
    .filter((entry) => FULL_ID.test(entry))
    .map((id) => ({ id, dir: `${root}/docker/${id}` }))
  return [...systemd, ...cgroupfs]
}

async function readUsageUsec(probe: ContainerProbe, dir: string): Promise<number | null> {
  const stat = await probe.readText(`${dir}/cpu.stat`)
  if (stat === null) {
    return null
  }
  const match = /^usage_usec (\d+)$/m.exec(stat)
  return match ? Number(match[1]) : null
}

const round1 = (value: number): number => Math.round(value * 10) / 10
const round2 = (value: number): number => Math.round(value * 100) / 100

async function readMemory(
  probe: ContainerProbe,
  dir: string,
  hostTotalMB: number,
): Promise<{ usageMB: number; limitMB: number } | null> {
  const current = parseCgroupBytes(await probe.readText(`${dir}/memory.current`))
  if (current === null) {
    return null
  }
  const stat = (await probe.readText(`${dir}/memory.stat`)) ?? ''
  const usage = Math.max(0, current - readStatField(stat, 'inactive_file'))
  const max = parseCgroupBytes(await probe.readText(`${dir}/memory.max`))
  return { usageMB: round1(usage / MB), limitMB: max === null ? hostTotalMB : round1(max / MB) }
}

export interface ContainerStatsInput {
  probe: ContainerProbe
  hostTotalMB: number
  names: ReadonlyMap<string, string>
  root?: string
  sampleMs?: number
}

// 消えたコンテナ (区間の間に止まった) は除く。メモリの多い順
export async function collectContainerStats(input: ContainerStatsInput): Promise<ContainerStat[]> {
  const { probe, hostTotalMB, names } = input
  const dirs = await findContainerDirs(probe, input.root ?? HOST_CGROUP_ROOT)
  if (dirs.length === 0) {
    return []
  }
  const startMs = probe.nowMs()
  const before = await Promise.all(dirs.map((c) => readUsageUsec(probe, c.dir)))
  await probe.sleep(input.sampleMs ?? CPU_SAMPLE_MS)
  const elapsedUsec = (probe.nowMs() - startMs) * 1000
  const self = probe.hostname()
  const stats = await Promise.all(
    dirs.map(async (c, index): Promise<ContainerStat | null> => {
      const memory = await readMemory(probe, c.dir, hostTotalMB)
      if (memory === null) {
        return null
      }
      const after = await readUsageUsec(probe, c.dir)
      const start = before[index] ?? null
      const cpuPercent =
        start === null || after === null || elapsedUsec <= 0 ? null : round2(((after - start) / elapsedUsec) * 100)
      const pids = parseCgroupBytes(await probe.readText(`${c.dir}/pids.current`))
      const id = c.id.slice(0, SHORT_ID_LENGTH)
      return {
        id,
        name: names.get(c.id) ?? null,
        isSelf: id === self,
        cpuPercent,
        memUsageMB: memory.usageMB,
        memLimitMB: memory.limitMB,
        pids,
      }
    }),
  )
  return stats
    .filter((stat): stat is ContainerStat => stat !== null)
    .sort((a, b) => b.memUsageMB - a.memUsageMB)
}
