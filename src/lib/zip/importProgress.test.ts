import { expect, test } from 'vitest'
import {
  importPercent,
  type ImportProgress,
  remainingSeconds,
  formatRemaining,
} from './importProgress'

function progress(overrides: Partial<ImportProgress> = {}): ImportProgress {
  return {
    phase: 'receiving',
    totalBytes: 1000,
    readBytes: 0,
    notesTotal: 0,
    notesDone: 0,
    ...overrides,
  }
}

// --- % ---

test('受信中はバイト比を 0〜90% に写す', () => {
  expect(importPercent(progress({ readBytes: 0 }))).toBe(0)
  expect(importPercent(progress({ readBytes: 500 }))).toBe(45)
  expect(importPercent(progress({ readBytes: 1000 }))).toBe(90)
})

test('ノート反映中は 90〜100% に写す', () => {
  const notes = { phase: 'notes' as const, notesTotal: 4 }
  expect(importPercent(progress({ ...notes, notesDone: 0 }))).toBe(90)
  expect(importPercent(progress({ ...notes, notesDone: 2 }))).toBe(95)
  expect(importPercent(progress({ ...notes, notesDone: 4 }))).toBe(100)
})

test('done は必ず 100%', () => {
  expect(importPercent(progress({ phase: 'done', readBytes: 0 }))).toBe(100)
})

// **後戻りしないこと**が配分の正しさより大事。段が変わる瞬間に数字が
// 減ると「壊れている」ように見える
test('段が変わっても % は後戻りしない', () => {
  const receiving = importPercent(progress({ readBytes: 1000 })) ?? 0
  const notesStart =
    importPercent(progress({ phase: 'notes', readBytes: 1000, notesTotal: 10, notesDone: 0 })) ?? 0
  expect(notesStart).toBeGreaterThanOrEqual(receiving)
})

test('ノートが 0 件でも 90% で止まらず 100% になる', () => {
  expect(importPercent(progress({ phase: 'notes', notesTotal: 0 }))).toBe(100)
})

// Content-Length が無い相手 (chunked) では割合を出しようがない。
// 出鱈目な数字を出すより「判らない」と言う
test('総バイト数が不明なら null', () => {
  expect(importPercent(progress({ totalBytes: null, readBytes: 500 }))).toBeNull()
})

test('名乗りより多く届いても 90% は超えない', () => {
  expect(importPercent(progress({ readBytes: 9999 }))).toBe(90)
})

// --- 残り時間 ---

test('経過と % から残りを見積もる', () => {
  // 10 秒で 50% → 残り 50% はあと 10 秒
  expect(remainingSeconds(50, 10_000)).toBe(10)
})

// 初速で計算した「残り 4000 秒」が一瞬見えるのは、数字が無いより悪い
test('始まったばかりのうちは見積もらない', () => {
  expect(remainingSeconds(1, 500)).toBeNull()
  expect(remainingSeconds(0, 10_000)).toBeNull()
})

test('% が判らないときは見積もらない', () => {
  expect(remainingSeconds(null, 10_000)).toBeNull()
})

test('100% まで来たら残りは 0', () => {
  expect(remainingSeconds(100, 10_000)).toBe(0)
})

test('残りは秒、90 秒を超えたら分に畳む', () => {
  expect(formatRemaining(0)).toBe('まもなく完了')
  expect(formatRemaining(9)).toBe('残り約 9 秒')
  expect(formatRemaining(90)).toBe('残り約 90 秒')
  expect(formatRemaining(91)).toBe('残り約 2 分')
  expect(formatRemaining(600)).toBe('残り約 10 分')
})
