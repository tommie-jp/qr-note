import { expect, test } from 'vitest'
import {
  DEFAULT_SCAN_BEEP_LEVEL,
  SCAN_BEEP_LEVELS,
  SCAN_BEEP_VOLUME_STORAGE_KEY,
  loadScanBeepLevel,
  parseScanBeepLevel,
  saveScanBeepLevel,
  scanBeepAmplitude,
  scanBeepLabel,
  stepScanBeepLevel,
} from './scanBeepVolume'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    map,
  }
}

test('保存されていなければ既定の「大」にする (設定前の挙動と同じ音量)', () => {
  expect(DEFAULT_SCAN_BEEP_LEVEL).toBe('high')
  expect(parseScanBeepLevel(null)).toBe('high')
})

test('保存された段をそのまま読む', () => {
  expect(parseScanBeepLevel('off')).toBe('off')
  expect(parseScanBeepLevel('low')).toBe('low')
  expect(parseScanBeepLevel('mid')).toBe('mid')
})

// localStorage は誰でも書ける。知らない値で黙らせたり壊したりしない
test('知らない値は既定に倒す', () => {
  expect(parseScanBeepLevel('')).toBe('high')
  expect(parseScanBeepLevel('0.5')).toBe('high')
  expect(parseScanBeepLevel('HIGH')).toBe('high')
})

test('保存して読み直すと同じ段になる', () => {
  const storage = memoryStorage()
  saveScanBeepLevel(storage, 'low')
  expect(storage.map.get(SCAN_BEEP_VOLUME_STORAGE_KEY)).toBe('low')
  expect(loadScanBeepLevel(storage)).toBe('low')
})

test('Storage が投げても既定で動き、書き込みは握る', () => {
  const broken = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  expect(loadScanBeepLevel(broken)).toBe('high')
  expect(() => saveScanBeepLevel(broken, 'off')).not.toThrow()
  expect(loadScanBeepLevel(null)).toBe('high')
})

test('＋で次の段へ、−で前の段へ動く', () => {
  expect(stepScanBeepLevel('low', 1)).toBe('mid')
  expect(stepScanBeepLevel('mid', -1)).toBe('low')
})

test('端では動かない', () => {
  expect(stepScanBeepLevel('high', 1)).toBe('high')
  expect(stepScanBeepLevel('off', -1)).toBe('off')
})

test('段の名前と振幅', () => {
  expect(scanBeepLabel('off')).toBe('消音')
  expect(scanBeepLabel('high')).toBe('大')
  expect(scanBeepAmplitude('off')).toBe(0)
  expect(scanBeepAmplitude('high')).toBe(1)
})

// 1 段ごとの聞こえ方を揃えるため、消音を除いて振幅は単調に増える
test('振幅は段の順に増える', () => {
  const amplitudes = SCAN_BEEP_LEVELS.map((level) => level.amplitude)
  for (let i = 1; i < amplitudes.length; i++) {
    expect(amplitudes[i]).toBeGreaterThan(amplitudes[i - 1])
  }
})
