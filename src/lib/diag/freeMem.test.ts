import { expect, test } from 'vitest'
import { parseFreeMem } from './freeMem'

// vps1 の free -m (2026-11-17) に近い値
const MEMINFO = `MemTotal:        2009512 kB
MemFree:          122880 kB
MemAvailable:    1234944 kB
Buffers:           40960 kB
Cached:          1000000 kB
SwapCached:        10000 kB
Shmem:             12288 kB
SReclaimable:      61440 kB
SwapTotal:       2097148 kB
SwapFree:        1366988 kB
`

test('free -m と同じ列を MiB の切り捨てで返す (used は total − available)', () => {
  // Act
  const mem = parseFreeMem(MEMINFO)

  // Assert
  expect(mem).toEqual({
    totalMB: 1962,
    usedMB: 756,
    freeMB: 120,
    sharedMB: 12,
    buffCacheMB: 1076,
    availableMB: 1206,
    swapTotalMB: 2047,
    swapUsedMB: 713,
    swapFreeMB: 1334,
  })
})

test('MemAvailable が無ければ null (半端な表を出さない)', () => {
  expect(parseFreeMem('MemTotal: 100 kB\nMemFree: 10 kB\n')).toBeNull()
})

test('スワップの無いホストは 0', () => {
  const mem = parseFreeMem('MemTotal: 2048 kB\nMemFree: 1024 kB\nMemAvailable: 1024 kB\n')
  expect(mem).toMatchObject({ swapTotalMB: 0, swapUsedMB: 0, swapFreeMB: 0, buffCacheMB: 0 })
})
