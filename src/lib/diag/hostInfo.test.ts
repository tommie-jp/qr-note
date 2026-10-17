import { expect, test } from 'vitest'
import {
  CGROUP_MEMORY_MAX_PATH,
  collectHostInfo,
  CONTAINER_OS_RELEASE_PATH,
  HOST_OS_RELEASE_PATH,
  type HostProbe,
  MEMINFO_PATH,
} from './hostInfo'

const FILES: Record<string, string> = {
  [HOST_OS_RELEASE_PATH]: 'PRETTY_NAME="Ubuntu 24.04.2 LTS"\n',
  [CONTAINER_OS_RELEASE_PATH]: 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n',
  [MEMINFO_PATH]:
    'MemTotal: 2097152 kB\nMemAvailable: 1048576 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n',
  [CGROUP_MEMORY_MAX_PATH]: '1073741824\n',
}

function probe(files: Record<string, string> = FILES): HostProbe {
  return {
    readText: async (path) => {
      const text = files[path]
      if (text === undefined) {
        throw new Error(`ENOENT: ${path}`)
      }
      return text
    },
    kernel: () => '6.8.0-60-generic',
    arch: () => 'x64',
    uptimeSeconds: () => 86400 * 3 + 3600 * 2 + 60 * 5,
    loadavg: () => [0.12, 0.3, 0.45],
    cpuCount: () => 2,
    hostname: () => 'a1b2c3d4e5f6',
  }
}

function rowValue(rows: { label: string; value: string }[], label: string) {
  const row = rows.find((r) => r.label === label)
  if (!row) {
    throw new Error(`row not found: ${label}`)
  }
  return row.value
}

test('ホストの節: マウントした os-release・カーネル・稼働時間・メモリ・スワップ', async () => {
  // Act
  const { sections, memory } = await collectHostInfo(probe())
  const host = sections.find((s) => s.id === 'host')!

  // Assert
  expect(host.result.kind).toBe('ok')
  const rows = host.result.kind === 'ok' ? host.result.rows : []
  expect(rowValue(rows, 'OS')).toBe('Ubuntu 24.04.2 LTS')
  expect(rowValue(rows, 'カーネル')).toBe('6.8.0-60-generic (x64)')
  expect(rowValue(rows, '稼働時間')).toBe('3 日 2 時間 5 分')
  expect(rowValue(rows, 'ロードアベレージ')).toBe('0.12 / 0.30 / 0.45')
  expect(rowValue(rows, 'CPU')).toBe('2 コア')
  expect(rowValue(rows, 'メモリ')).toBe('利用可能 1.0 GB / 2.0 GB (50%)')
  expect(rowValue(rows, 'スワップ')).toBe('使用 512.0 MB / 1.0 GB (50%)')
  expect(memory?.availableBytes).toBe(1048576 * 1024)
})

test('コンテナの節: 自身の os-release・ホスト名・cgroup のメモリ上限', async () => {
  // Act
  const { sections } = await collectHostInfo(probe())
  const container = sections.find((s) => s.id === 'container')!

  // Assert
  const rows = container.result.kind === 'ok' ? container.result.rows : []
  expect(rowValue(rows, 'OS')).toBe('Debian GNU/Linux 12 (bookworm)')
  expect(rowValue(rows, 'ホスト名 (コンテナ ID)')).toBe('a1b2c3d4e5f6')
  expect(rowValue(rows, 'メモリ上限 (cgroup)')).toBe('1.0 GB')
})

test('ホストの os-release が無ければその行だけ不明にし、マウント漏れを名指しする', async () => {
  // Arrange
  const { [HOST_OS_RELEASE_PATH]: _omit, ...files } = FILES

  // Act
  const { sections } = await collectHostInfo(probe(files))
  const host = sections.find((s) => s.id === 'host')!

  // Assert
  expect(host.result.kind).toBe('ok')
  const rows = host.result.kind === 'ok' ? host.result.rows : []
  expect(rowValue(rows, 'OS')).toContain('不明')
  expect(rowValue(rows, 'OS')).toContain(HOST_OS_RELEASE_PATH)
  expect(rowValue(rows, 'カーネル')).toBe('6.8.0-60-generic (x64)')
})

test('meminfo が読めなければメモリの行は不明、memory は null', async () => {
  // Arrange
  const { [MEMINFO_PATH]: _omit, ...files } = FILES

  // Act
  const { sections, memory } = await collectHostInfo(probe(files))
  const host = sections.find((s) => s.id === 'host')!
  const rows = host.result.kind === 'ok' ? host.result.rows : []

  // Assert
  expect(memory).toBeNull()
  expect(rowValue(rows, 'メモリ')).toContain('不明')
})

test('cgroup の上限が max (無制限) なら「無制限」', async () => {
  // Arrange
  const files = { ...FILES, [CGROUP_MEMORY_MAX_PATH]: 'max\n' }

  // Act
  const { sections } = await collectHostInfo(probe(files))
  const container = sections.find((s) => s.id === 'container')!
  const rows = container.result.kind === 'ok' ? container.result.rows : []

  // Assert
  expect(rowValue(rows, 'メモリ上限 (cgroup)')).toBe('無制限')
})
