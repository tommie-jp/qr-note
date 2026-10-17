import { describe, expect, test } from 'vitest'
import {
  loadNoteChromePinnedPref,
  NOTE_CHROME_PINNED_DEFAULT,
  NOTE_CHROME_PINNED_STORAGE_KEY,
  noteChromeLayout,
  parseNoteChromePinnedPref,
  saveNoteChromePinnedPref,
} from './noteChrome'

// 読み書きだけの偽 Storage (localStorage の全機能は要らない)
const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = { ...initial }
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
  }
}

describe('noteChromeLayout', () => {
  test('既定 (器あり・好みなし・読むタブ) は畳んで重ねる', () => {
    expect(
      noteChromeLayout({ collapsible: true, pinned: false, editing: false }),
    ).toBe('overlay')
  })

  test('編集タブの間は畳まない (戻り口を消さない)', () => {
    expect(
      noteChromeLayout({ collapsible: true, pinned: false, editing: true }),
    ).toBe('inline')
  })

  test('「常に出す」の端末では畳まない', () => {
    expect(
      noteChromeLayout({ collapsible: true, pinned: true, editing: false }),
    ).toBe('inline')
  })

  test('畳める器が無い (公開ビュー) なら従来どおり積む', () => {
    expect(
      noteChromeLayout({ collapsible: false, pinned: false, editing: false }),
    ).toBe('inline')
  })
})

describe('「常に出す」の好み', () => {
  test('既定は畳む (常に出さない)', () => {
    expect(NOTE_CHROME_PINNED_DEFAULT).toBe(false)
    expect(parseNoteChromePinnedPref(null)).toBe(false)
  })

  test('知らない値は既定に倒す', () => {
    expect(parseNoteChromePinnedPref('yes')).toBe(false)
  })

  test('保存した値を読み戻せる', () => {
    const storage = fakeStorage()
    saveNoteChromePinnedPref(storage, true)
    expect(storage.values[NOTE_CHROME_PINNED_STORAGE_KEY]).toBeDefined()
    expect(loadNoteChromePinnedPref(storage)).toBe(true)
    saveNoteChromePinnedPref(storage, false)
    expect(loadNoteChromePinnedPref(storage)).toBe(false)
  })

  test('Storage が無い環境では既定', () => {
    expect(loadNoteChromePinnedPref(null)).toBe(false)
  })
})
