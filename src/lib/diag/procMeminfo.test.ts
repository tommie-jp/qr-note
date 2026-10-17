import { expect, test } from 'vitest'
import { parseMeminfo } from './procMeminfo'

const MEMINFO = `MemTotal:        2010000 kB
MemFree:          120000 kB
MemAvailable:     750000 kB
Buffers:           30000 kB
SwapTotal:       2097148 kB
SwapFree:        1048574 kB
`

test('/proc/meminfo の kB をバイトにして 4 つ返す', () => {
  // Act
  const mem = parseMeminfo(MEMINFO)

  // Assert
  expect(mem).toEqual({
    totalBytes: 2010000 * 1024,
    availableBytes: 750000 * 1024,
    swapTotalBytes: 2097148 * 1024,
    swapFreeBytes: 1048574 * 1024,
  })
})

test('スワップの行が無ければ 0 (スワップ無しの環境)', () => {
  // Arrange
  const text = 'MemTotal: 1000 kB\nMemAvailable: 500 kB\n'

  // Act
  const mem = parseMeminfo(text)

  // Assert
  expect(mem).toEqual({
    totalBytes: 1000 * 1024,
    availableBytes: 500 * 1024,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
  })
})

test('MemTotal か MemAvailable が無ければ null (読めたふりをしない)', () => {
  expect(parseMeminfo('MemTotal: 1000 kB\n')).toBeNull()
  expect(parseMeminfo('')).toBeNull()
  expect(parseMeminfo('MemTotal: abc kB\nMemAvailable: 1 kB\n')).toBeNull()
})
