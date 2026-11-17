// 計測前のホストの様子 (free -m・docker stats 相当) を 1 枚にまとめる。
//
// 本番 (vps1) で手で流していた `free -m` と `docker stats --no-stream`
// (docs/127 §6 の 5) を「サーバを計測」に取り込んだもの。読めない物は
// 節を落とさず notes に理由を書く (マウント漏れと「動いていない」を取り違えない)
import 'server-only'
import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import type { HostSnapshot } from './benchTypes'
import {
  collectContainerStats,
  CONTAINER_NAMES_PATH,
  type ContainerProbe,
  HOST_CGROUP_ROOT,
  parseContainerNames,
} from './containerStats'
import { parseFreeMem } from './freeMem'
import { MEMINFO_PATH } from './hostInfo'
import { safeErrorText } from './safeErrorText'

export interface HostSnapshotProbe extends ContainerProbe {
  // 更新日時 (ISO)。無ければ null
  mtimeIso(path: string): Promise<string | null>
}

const nodeProbe: HostSnapshotProbe = {
  listDir: (path) => readdir(path),
  readText: (path) => readFile(path, 'utf8').catch(() => null),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowMs: () => performance.now(),
  hostname: () => os.hostname(),
  mtimeIso: (path) => stat(path).then((s) => s.mtime.toISOString(), () => null),
}

export async function collectHostSnapshot(probe: HostSnapshotProbe = nodeProbe): Promise<HostSnapshot> {
  const takenAt = new Date().toISOString()
  const notes: string[] = []
  const meminfo = await probe.readText(MEMINFO_PATH)
  const freeMem = meminfo === null ? null : parseFreeMem(meminfo)
  if (freeMem === null) {
    notes.push(`メモリ: ${MEMINFO_PATH} が読めない`)
  }
  const namesText = await probe.readText(CONTAINER_NAMES_PATH)
  const namesAt = namesText === null ? null : await probe.mtimeIso(CONTAINER_NAMES_PATH)
  if (namesText === null) {
    notes.push(`コンテナ名: ${CONTAINER_NAMES_PATH} が無い (配布で書かれる。名前の代わりに ID を出す)`)
  }
  const hostTotalMB = freeMem?.totalMB ?? Math.floor(os.totalmem() / (1024 * 1024))
  let containers: HostSnapshot['containers'] = []
  try {
    containers = await collectContainerStats({
      probe,
      hostTotalMB,
      names: parseContainerNames(namesText ?? ''),
    })
    if (containers.length === 0) {
      notes.push(`コンテナ: ${HOST_CGROUP_ROOT} にコンテナの cgroup が無い (compose のマウントを確認)`)
    }
  } catch (error) {
    notes.push(`コンテナ: ${safeErrorText(error)}`)
  }
  return { takenAt, freeMem, containers, namesAt, notes }
}
