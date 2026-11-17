import { expect, test } from 'vitest'
import {
  collectContainerStats,
  type ContainerProbe,
  findContainerDirs,
  parseContainerNames,
  readStatField,
} from './containerStats'

const APP = 'b786a64d6bb2'.padEnd(64, '0')
const DB = '83e30cd4b070'.padEnd(64, '1')
const MB = 1024 * 1024

// ファイルの中身を path → 文字列で持つ偽物。cpu.stat は 2 回目の読みで進める
function fakeProbe(files: Record<string, string>, dirs: Record<string, string[]>, cpuAfter: Record<string, string>): ContainerProbe {
  let slept = false
  let now = 0
  return {
    listDir: async (path) => {
      const entries = dirs[path]
      if (!entries) throw new Error(`ENOENT ${path}`)
      return entries
    },
    readText: async (path) => (slept && cpuAfter[path] !== undefined ? cpuAfter[path] : files[path]) ?? null,
    sleep: async (ms) => {
      slept = true
      now += ms
    },
    nowMs: () => now,
    hostname: () => 'b786a64d6bb2',
  }
}

test('docker ps の表から 64 桁の ID と名前を読む (壊れた行は捨てる)', () => {
  const names = parseContainerNames(`${APP}\tqr-search-app-1\nshort\tx\n\n${DB}\tqr-search-db-1\n`)
  expect([...names.entries()]).toEqual([
    [APP, 'qr-search-app-1'],
    [DB, 'qr-search-db-1'],
  ])
})

test('memory.stat の項目を読み、無ければ 0', () => {
  expect(readStatField('anon 10\ninactive_file 36364288\n', 'inactive_file')).toBe(36364288)
  expect(readStatField('anon 10\n', 'inactive_file')).toBe(0)
})

test('systemd と cgroupfs の両方の置き場所からコンテナを見つける', async () => {
  const probe = fakeProbe({}, {
    '/r/system.slice': [`docker-${APP}.scope`, 'ssh.service', 'docker.service'],
    '/r/docker': [DB, 'cgroup.procs'],
  }, {})
  expect(await findContainerDirs(probe, '/r')).toEqual([
    { id: APP, dir: `/r/system.slice/docker-${APP}.scope` },
    { id: DB, dir: `/r/docker/${DB}` },
  ])
})

test('docker stats と同じ計算で、メモリの多い順に返す', async () => {
  // Arrange
  const app = `/r/system.slice/docker-${APP}.scope`
  const db = `/r/system.slice/docker-${DB}.scope`
  const probe = fakeProbe(
    {
      [`${app}/memory.current`]: `${300 * MB}\n`,
      [`${app}/memory.stat`]: `anon 1\ninactive_file ${85 * MB}\n`,
      [`${app}/memory.max`]: `${1600 * MB}\n`,
      [`${app}/cpu.stat`]: 'usage_usec 1000000\n',
      [`${app}/pids.current`]: '11\n',
      [`${db}/memory.current`]: `${64 * MB}\n`,
      [`${db}/memory.stat`]: 'inactive_file 0\n',
      [`${db}/memory.max`]: 'max\n',
      [`${db}/cpu.stat`]: 'usage_usec 5000\n',
    },
    { '/r/system.slice': [`docker-${APP}.scope`, `docker-${DB}.scope`] },
    { [`${app}/cpu.stat`]: 'usage_usec 1250000\n', [`${db}/cpu.stat`]: 'usage_usec 5000\n' },
  )

  // Act
  const stats = await collectContainerStats({
    probe,
    hostTotalMB: 1962,
    names: new Map([[DB, 'qr-search-db-1']]),
    root: '/r',
    sampleMs: 1000,
  })

  // Assert
  expect(stats).toEqual([
    { id: 'b786a64d6bb2', name: null, isSelf: true, cpuPercent: 25, memUsageMB: 215, memLimitMB: 1600, pids: 11 },
    { id: '83e30cd4b070', name: 'qr-search-db-1', isSelf: false, cpuPercent: 0, memUsageMB: 64, memLimitMB: 1962, pids: null },
  ])
})

test('cgroup がマウントされていなければ空 (待たない)', async () => {
  const probe = fakeProbe({}, {}, {})
  expect(await collectContainerStats({ probe, hostTotalMB: 1, names: new Map(), root: '/r' })).toEqual([])
})
