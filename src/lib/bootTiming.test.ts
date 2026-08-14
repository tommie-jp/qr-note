import { describe, expect, test } from 'vitest'
import {
  formatBootTiming,
  parseWorkerVersion,
  readBootTiming,
  shouldReportBoot,
  whiteScreenMs,
} from './bootTiming'

// 実機 (iPhone) から届く形を模した performance。テストは environment: 'node' で
// 走るので、本物の PerformanceNavigationTiming は無い — 注入して確かめる
function fakePerformance(entries: {
  navigation?: unknown[]
  paint?: unknown[]
  resource?: unknown[]
}) {
  return {
    getEntriesByType: (type: string) =>
      ({
        navigation: entries.navigation ?? [],
        paint: entries.paint ?? [],
        resource: entries.resource ?? [],
      })[type] ?? [],
  }
}

const NAVIGATION = {
  type: 'navigate',
  workerStart: 40,
  requestStart: 60,
  responseStart: 12_800,
  responseEnd: 13_100,
  domContentLoadedEventEnd: 13_600,
  loadEventEnd: 21_000,
}

describe('readBootTiming', () => {
  test('reads the breakdown of the initial document load', () => {
    // Arrange
    const perf = fakePerformance({
      navigation: [NAVIGATION],
      paint: [{ name: 'first-contentful-paint', startTime: 13_400 }],
    })

    // Act
    const timing = readBootTiming(perf)

    // Assert
    expect(timing).toEqual({
      navType: 'navigate',
      workerStartMs: 40,
      requestStartMs: 60,
      responseStartMs: 12_800,
      responseEndMs: 13_100,
      domContentLoadedMs: 13_600,
      loadMs: 21_000,
      firstContentfulPaintMs: 13_400,
      slowResources: [],
    })
  })

  test('returns null when there is no navigation entry', () => {
    expect(readBootTiming(fakePerformance({}))).toBeNull()
  })

  test('returns null when performance itself is missing', () => {
    expect(readBootTiming(undefined)).toBeNull()
  })

  test('reports workerStart 0 as "no Service Worker involved"', () => {
    // Arrange: 仕様上 0 は「Worker を通らなかった」の意で、0ms ではない
    const perf = fakePerformance({ navigation: [{ ...NAVIGATION, workerStart: 0 }] })

    // Act / Assert
    expect(readBootTiming(perf)?.workerStartMs).toBeNull()
  })

  test('reports FCP as unknown when the browser did not record it', () => {
    // Arrange: paint timing を持たない環境がある
    const perf = fakePerformance({ navigation: [NAVIGATION], paint: [] })

    // Act / Assert
    expect(readBootTiming(perf)?.firstContentfulPaintMs).toBeNull()
  })

  test('keeps the three slowest resources, shortened and marked when served by the worker', () => {
    // Arrange
    const perf = fakePerformance({
      navigation: [NAVIGATION],
      resource: [
        {
          name: 'https://example.com/_next/static/css/a1b2.css',
          startTime: 300,
          duration: 8200,
          workerStart: 310,
        },
        { name: 'https://example.com/_next/static/chunks/x.js', startTime: 400, duration: 3100 },
        { name: 'https://example.com/_next/static/chunks/y.js', startTime: 400, duration: 900 },
        { name: 'https://example.com/_next/static/chunks/z.js', startTime: 400, duration: 500 },
        // 速いものは診断に効かないので落とす
        { name: 'https://example.com/api/images/small', startTime: 400, duration: 20 },
      ],
    })

    // Act
    const slow = readBootTiming(perf)?.slowResources

    // Assert
    expect(slow).toEqual([
      { name: 'css/a1b2.css', durationMs: 8200, viaWorker: true },
      { name: 'chunks/x.js', durationMs: 3100, viaWorker: false },
      { name: 'chunks/y.js', durationMs: 900, viaWorker: false },
    ])
  })
})

describe('whiteScreenMs', () => {
  test('uses FCP — that is when the white screen ends', () => {
    const timing = readBootTiming(
      fakePerformance({
        navigation: [NAVIGATION],
        paint: [{ name: 'first-contentful-paint', startTime: 13_400 }],
      }),
    )

    expect(whiteScreenMs(timing!)).toBe(13_400)
  })

  test('falls back to the end of the response when FCP is unknown', () => {
    const timing = readBootTiming(fakePerformance({ navigation: [NAVIGATION] }))

    expect(whiteScreenMs(timing!)).toBe(13_100)
  })
})

describe('shouldReportBoot', () => {
  const fast = readBootTiming(
    fakePerformance({
      navigation: [{ ...NAVIGATION, responseStart: 200, responseEnd: 300 }],
      paint: [{ name: 'first-contentful-paint', startTime: 500 }],
    }),
  )!
  const slow = readBootTiming(
    fakePerformance({
      navigation: [NAVIGATION],
      paint: [{ name: 'first-contentful-paint', startTime: 13_400 }],
    }),
  )!

  test('always reports the first launch of a new version (right after a deploy)', () => {
    expect(shouldReportBoot(fast, '0.22.58', '0.22.59')).toBe(true)
  })

  test('reports a slow launch even on a version that was already reported', () => {
    expect(shouldReportBoot(slow, '0.22.59', '0.22.59')).toBe(true)
  })

  test('stays quiet on a normal launch of a known version', () => {
    expect(shouldReportBoot(fast, '0.22.59', '0.22.59')).toBe(false)
  })

  test('reports when no version was recorded yet', () => {
    expect(shouldReportBoot(fast, null, '0.22.59')).toBe(true)
  })
})

describe('parseWorkerVersion', () => {
  test('reads the version the controlling worker was registered with', () => {
    expect(parseWorkerVersion('https://example.com/sw.js?v=0.22.58')).toBe('0.22.58')
  })

  test('returns null when nothing controls the page', () => {
    expect(parseWorkerVersion(null)).toBeNull()
  })

  test('returns null when the URL carries no version', () => {
    expect(parseWorkerVersion('https://example.com/sw.js')).toBeNull()
  })

  test('returns null for a URL it cannot parse', () => {
    expect(parseWorkerVersion('sw.js?v=1')).toBeNull()
  })
})

describe('formatBootTiming', () => {
  test('puts the server wait, the paint and the slow resources on one line', () => {
    // Arrange
    const timing = readBootTiming(
      fakePerformance({
        navigation: [NAVIGATION],
        paint: [{ name: 'first-contentful-paint', startTime: 13_400 }],
        resource: [
          {
            name: 'https://example.com/_next/static/css/a1b2.css',
            startTime: 300,
            duration: 8200,
            workerStart: 310,
          },
        ],
      }),
    )!

    // Act
    const line = formatBootTiming(timing, {
      version: '0.22.59',
      workerVersion: '0.22.58',
      standalone: true,
      online: true,
    })

    // Assert
    expect(line).toContain('[起動]')
    expect(line).toContain('v0.22.59')
    expect(line).toContain('SW v0.22.58')
    expect(line).toContain('PWA')
    expect(line).toContain('応答待ち 12800ms')
    expect(line).toContain('FCP 13400ms')
    expect(line).toContain('SW起動 40ms')
    expect(line).toContain('css/a1b2.css 8200ms(SW)')
  })

  test('marks a report sent before load and says which marks are still missing', () => {
    // Arrange: load を待たずに送る途中経過。まだ立っていない印は 0 で届く
    const timing = readBootTiming(
      fakePerformance({
        navigation: [
          { ...NAVIGATION, domContentLoadedEventEnd: 0, loadEventEnd: 0 },
        ],
      }),
    )!

    // Act
    const line = formatBootTiming(timing, {
      version: '0.22.63',
      workerVersion: '0.22.62',
      standalone: true,
      online: true,
    })

    // Assert: 0ms と読み違えると「一瞬で終わった」に見えるので、未了と書く
    expect(line).toContain('[起動(途中)]')
    expect(line).toContain('DCL 未了')
    expect(line).toContain('load 未了')
    expect(line).toContain('受信 13100ms')
  })

  test('says so when the page is not controlled by a worker', () => {
    const timing = readBootTiming(
      fakePerformance({ navigation: [{ ...NAVIGATION, workerStart: 0 }] }),
    )!

    const line = formatBootTiming(timing, {
      version: '0.22.59',
      workerVersion: null,
      standalone: false,
      online: false,
    })

    expect(line).toContain('SW無し')
    expect(line).toContain('ブラウザ')
    expect(line).toContain('圏外')
    expect(line).toContain('SW仲介なし')
    expect(line).toContain('FCP不明')
  })
})
