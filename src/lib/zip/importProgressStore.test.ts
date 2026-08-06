import { beforeEach, expect, test } from 'vitest'
import {
  beginImport,
  currentImport,
  ImportBusyError,
  releaseImport,
} from './importProgressStore'

beforeEach(() => {
  releaseImport()
})

test('取り込んでいなければ進捗は null', () => {
  expect(currentImport()).toBeNull()
})

test('始めると受信中の進捗が見える', () => {
  beginImport(1000)
  expect(currentImport()).toMatchObject({
    phase: 'receiving',
    totalBytes: 1000,
    readBytes: 0,
  })
})

// importZip は同時実行を想定していない (採番・衝突判定が競合する)。
// 進捗のスロット以前に必要な門
test('取り込み中に始めようとしたら断る', () => {
  beginImport(1000)
  expect(() => beginImport(2000)).toThrow(ImportBusyError)
})

test('終わっていれば次を始められる', () => {
  const handle = beginImport(1000)
  handle.finish()
  expect(() => beginImport(2000)).not.toThrow()
})

test('解放すれば次を始められる (失敗して途中で抜けたとき)', () => {
  beginImport(1000)
  releaseImport()
  expect(() => beginImport(2000)).not.toThrow()
})

test('読んだバイト数を積み上げる', () => {
  const handle = beginImport(1000)
  handle.addBytes(300)
  handle.addBytes(200)
  expect(currentImport()?.readBytes).toBe(500)
})

test('ノートの反映に移ると段が変わる', () => {
  const handle = beginImport(1000)
  handle.startNotes(7)
  expect(currentImport()).toMatchObject({ phase: 'notes', notesTotal: 7, notesDone: 0 })
  handle.noteDone()
  expect(currentImport()?.notesDone).toBe(1)
})

test('終わると done になり、経過も残る', () => {
  const handle = beginImport(1000)
  handle.finish()
  expect(currentImport()).toMatchObject({ phase: 'done' })
})

// 応答が返る前に画面を閉じられても、次の取り込みが永久に始められなくならない
test('古い取り込みは覗いたときに片付ける', () => {
  const startedAt = Date.now()
  beginImport(1000, startedAt)
  // 覗く時刻が十分に後なら、取り残しとみなして消える
  expect(currentImport(startedAt + 60 * 60 * 1000)).toBeNull()
  expect(() => beginImport(2000)).not.toThrow()
})

// 別の取り込みが始まった後に古い handle が触っても、新しい進捗を汚さない
test('解放済みの handle からの更新は無視する', () => {
  const stale = beginImport(1000)
  releaseImport()
  const fresh = beginImport(2000)
  stale.addBytes(999)
  expect(currentImport()?.readBytes).toBe(0)
  fresh.addBytes(10)
  expect(currentImport()?.readBytes).toBe(10)
})
