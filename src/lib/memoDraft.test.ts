import { describe, expect, test } from 'vitest'

import { BASE_STALE } from './saveBase'
import {
  draftStorageKey,
  loadDraft,
  parseDraft,
  persistDraft,
} from './memoDraft'

// localStorage の代役 (テストでは本物を使わない)
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

describe('draftStorageKey', () => {
  test('builds a per-item key', () => {
    expect(draftStorageKey('1019')).toBe('qr-search:memo-draft:1019')
  })
})

describe('parseDraft', () => {
  test('parses a valid draft', () => {
    const raw = JSON.stringify({ value: '本文', savedAt: 123, base: '1787000000123' })

    expect(parseDraft(raw)).toEqual({
      value: '本文',
      savedAt: 123,
      base: '1787000000123',
    })
  })

  test('基点の無い旧形式も読める (base だけ落ちる)', () => {
    const raw = JSON.stringify({ value: '本文', savedAt: 123 })

    expect(parseDraft(raw)).toEqual({ value: '本文', savedAt: 123 })
  })

  test('base が文字列でなければ捨てる (localStorage は外部入力)', () => {
    const raw = JSON.stringify({ value: '本文', savedAt: 123, base: 999 })

    expect(parseDraft(raw)).toEqual({ value: '本文', savedAt: 123 })
  })

  test('returns null for null input', () => {
    expect(parseDraft(null)).toBeNull()
  })

  test('returns null for broken JSON', () => {
    expect(parseDraft('{oops')).toBeNull()
  })

  test('returns null when fields are missing or wrong-typed', () => {
    expect(parseDraft(JSON.stringify({ value: 1, savedAt: 'x' }))).toBeNull()
    expect(parseDraft(JSON.stringify({ savedAt: 123 }))).toBeNull()
  })
})

describe('persistDraft', () => {
  test('saves the draft when the value differs from the initial value', () => {
    const storage = fakeStorage()

    persistDraft(storage, '7', '編集後', '初期値', '1787000000123', 456)

    // 本文と**基点を対で**残す。基点が無いと、復元した古い本文を
    // 新しい基点で保存でき、別の端末の版を黙って潰せてしまう
    expect(parseDraft(storage.getItem(draftStorageKey('7')))).toEqual({
      value: '編集後',
      savedAt: 456,
      base: '1787000000123',
    })
  })

  test('removes the draft when the value matches the initial value', () => {
    const storage = fakeStorage({
      [draftStorageKey('7')]: JSON.stringify({ value: '古い', savedAt: 1 }),
    })

    persistDraft(storage, '7', '同じ', '同じ', '1787000000123', 456)

    expect(storage.getItem(draftStorageKey('7'))).toBeNull()
  })
})

describe('loadDraft', () => {
  test('returns the draft value with its base when it differs', () => {
    const storage = fakeStorage({
      [draftStorageKey('7')]: JSON.stringify({
        value: '未保存',
        savedAt: 1,
        base: '1787000000123',
      }),
    })

    expect(loadDraft(storage, '7', '初期値')).toEqual({
      value: '未保存',
      base: '1787000000123',
    })
  })

  test('基点を持たない旧形式は stale で返す (必ず競合にする)', () => {
    // 現在の基点を当てると「古い本文 + 新しい基点」になり、塞ぎたい経路そのもの
    const storage = fakeStorage({
      [draftStorageKey('7')]: JSON.stringify({ value: '未保存', savedAt: 1 }),
    })

    expect(loadDraft(storage, '7', '初期値')).toEqual({
      value: '未保存',
      base: BASE_STALE,
    })
  })

  test('returns null and cleans up when the draft equals the initial value', () => {
    // 保存が成功した後の再訪: サーバ値と同じ下書きはもう用済み
    const storage = fakeStorage({
      [draftStorageKey('7')]: JSON.stringify({ value: '保存済み', savedAt: 1 }),
    })

    expect(loadDraft(storage, '7', '保存済み')).toBeNull()
    expect(storage.getItem(draftStorageKey('7'))).toBeNull()
  })

  test('returns null when there is no draft', () => {
    expect(loadDraft(fakeStorage(), '7', '初期値')).toBeNull()
  })

  test('returns null and cleans up for a broken draft', () => {
    const storage = fakeStorage({ [draftStorageKey('7')]: '{oops' })

    expect(loadDraft(storage, '7', '初期値')).toBeNull()
    expect(storage.getItem(draftStorageKey('7'))).toBeNull()
  })
})
