import { describe, expect, test } from 'vitest'
import {
  formatDiagEvent,
  formatEnvSummary,
  readEnvInfo,
  readMemorySnapshot,
} from './diagLog'

describe('readMemorySnapshot', () => {
  test('reads Chrome performance.memory when present', () => {
    // Arrange: Blink 系だけが持つ非標準 API
    const perf = {
      memory: {
        usedJSHeapSize: 123 * 1024 * 1024,
        totalJSHeapSize: 256 * 1024 * 1024,
        jsHeapSizeLimit: 4096 * 1024 * 1024,
      },
    }

    // Act
    const snapshot = readMemorySnapshot(perf)

    // Assert
    expect(snapshot).toEqual({ usedMB: 123, totalMB: 256, limitMB: 4096 })
  })

  test('returns null on WebKit (iPhone) where the API does not exist', () => {
    // Arrange: iOS は全ブラウザが WebKit で performance.memory を持たない
    const perf = {}

    // Act / Assert
    expect(readMemorySnapshot(perf)).toBeNull()
  })

  test('returns null when performance itself is missing', () => {
    expect(readMemorySnapshot(undefined)).toBeNull()
  })

  test('returns null when the fields are not numbers', () => {
    // Arrange: 外から来た形は信じない
    const perf = { memory: { usedJSHeapSize: 'a', jsHeapSizeLimit: null } }

    // Act / Assert
    expect(readMemorySnapshot(perf)).toBeNull()
  })
})

describe('formatDiagEvent', () => {
  test('appends used/allocated/limit heap sizes when a snapshot is available', () => {
    // Arrange / Act: 使用/確保済み/上限 の 3 つ (上限 1120MB は 32bit の指紋)
    const text = formatDiagEvent('[OCR] Worker 起動', {
      usedMB: 123,
      totalMB: 256,
      limitMB: 4096,
    })

    // Assert
    expect(text).toBe('[OCR] Worker 起動 [JSヒープ 使用123 確保256 上限4096MB]')
  })

  test('returns the event alone when no snapshot is available (iPhone)', () => {
    // Arrange / Act
    const text = formatDiagEvent('[OCR] Worker 起動', null)

    // Assert: iPhone では数値が取れないので、イベントと時刻だけで診断する
    expect(text).toBe('[OCR] Worker 起動')
  })
})

describe('readEnvInfo', () => {
  test('reads bitness/architecture/wow64 from UA client hints', async () => {
    // Arrange: 64bit Windows 上の 32bit Chrome (実際に踏んだ構成)
    const nav = {
      userAgentData: {
        getHighEntropyValues: async () => ({
          architecture: 'x86',
          bitness: '32',
          wow64: true,
        }),
      },
      deviceMemory: 4,
      hardwareConcurrency: 8,
    }

    // Act
    const info = await readEnvInfo(nav)

    // Assert
    expect(info).toEqual({
      bitness: '32',
      architecture: 'x86',
      wow64: true,
      deviceMemoryGB: 4,
      cores: 8,
    })
  })

  test('reports unknown bitness on WebKit (no userAgentData)', async () => {
    // Arrange: iPhone は userAgentData も deviceMemory も無い
    const nav = { hardwareConcurrency: 6 }

    // Act
    const info = await readEnvInfo(nav)

    // Assert
    expect(info.bitness).toBeNull()
    expect(info.deviceMemoryGB).toBeNull()
    expect(info.cores).toBe(6)
  })

  test('stays unknown when the hints call rejects', async () => {
    // Arrange: 将来のポリシー変更などで拒否されても落ちない
    const nav = {
      userAgentData: {
        getHighEntropyValues: async () => {
          throw new Error('denied')
        },
      },
    }

    // Act
    const info = await readEnvInfo(nav)

    // Assert
    expect(info.bitness).toBeNull()
  })
})

describe('formatEnvSummary', () => {
  test('names the 32bit browser explicitly (the smoking gun)', () => {
    // Arrange / Act
    const text = formatEnvSummary({
      bitness: '32',
      architecture: 'x86',
      wow64: true,
      deviceMemoryGB: 4,
      cores: 8,
    })

    // Assert: WOW64 = 64bit OS 上の 32bit ブラウザ。入れ替えれば直ると分かる
    expect(text).toBe('[環境] ブラウザ 32bit x86 (WOW64) / RAM ~4GB / CPUコア 8')
  })

  test('says unknown instead of guessing on WebKit', () => {
    // Arrange / Act
    const text = formatEnvSummary({
      bitness: null,
      architecture: null,
      wow64: null,
      deviceMemoryGB: null,
      cores: 6,
    })

    // Assert
    expect(text).toBe('[環境] ブラウザ ビット数不明 (userAgentData 非対応) / CPUコア 6')
  })
})
