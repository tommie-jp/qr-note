import { describe, expect, test } from 'vitest'
import {
  clipboardFileName,
  clipboardReadErrorMessage,
  pickClipboardEntry,
  type ClipboardEntry,
} from './clipboardRead'

// navigator.clipboard.read() が返す ClipboardItem の、この関数が見る部分だけ。
// 本物の ClipboardItem は node に無いので、types と getType だけを持つ器で試す
function entry(...types: string[]): ClipboardEntry {
  return {
    types,
    getType: (type: string) => Promise.resolve(new Blob([type], { type })),
  }
}

describe('pickClipboardEntry', () => {
  test('prefers image/png over other image types', () => {
    const item = entry('image/webp', 'image/png')
    expect(pickClipboardEntry([item])).toEqual({
      kind: 'image',
      type: 'image/png',
      entry: item,
    })
  })

  test('picks a non-png image when png is absent', () => {
    const item = entry('image/jpeg')
    expect(pickClipboardEntry([item])).toEqual({
      kind: 'image',
      type: 'image/jpeg',
      entry: item,
    })
  })

  test('prefers an image even when a text entry comes first', () => {
    const text = entry('text/plain')
    const image = entry('image/png')
    expect(pickClipboardEntry([text, image])?.kind).toBe('image')
  })

  test('prefers a png entry over a jpeg entry listed earlier', () => {
    const jpeg = entry('image/jpeg')
    const png = entry('image/png')
    expect(pickClipboardEntry([jpeg, png])).toEqual({
      kind: 'image',
      type: 'image/png',
      entry: png,
    })
  })

  test('falls back to text/plain when there is no image', () => {
    const item = entry('text/html', 'text/plain')
    expect(pickClipboardEntry([item])).toEqual({
      kind: 'text',
      type: 'text/plain',
      entry: item,
    })
  })

  test('returns null when nothing is usable', () => {
    expect(pickClipboardEntry([entry('text/html')])).toBeNull()
    expect(pickClipboardEntry([])).toBeNull()
  })
})

describe('clipboardFileName', () => {
  // オフセットを付けない = 実行環境の地方時。TZ が違う土台でも同じ結果になる
  const at = new Date('2026-09-12T15:30:45')

  test('names a png by the local date and time', () => {
    expect(clipboardFileName('image/png', at)).toBe('clipboard-20260912-153045.png')
  })

  test('uses the extension the app stores for that mime', () => {
    expect(clipboardFileName('image/jpeg', at)).toBe('clipboard-20260912-153045.jpg')
  })

  test('falls back to png for a mime the app does not know', () => {
    expect(clipboardFileName('image/x-weird', at)).toBe(
      'clipboard-20260912-153045.png',
    )
  })
})

describe('clipboardReadErrorMessage', () => {
  test('says the read was refused instead of repeating the DOMException', () => {
    const denied = Object.assign(new Error('Read permission denied.'), {
      name: 'NotAllowedError',
    })
    expect(clipboardReadErrorMessage(denied)).toBe(
      'クリップボードの読み取りが許可されませんでした',
    )
  })

  test('passes other errors through so the real cause stays readable', () => {
    expect(clipboardReadErrorMessage(new Error('boom'))).toBe('boom')
  })

  test('survives something that is not an Error at all', () => {
    expect(clipboardReadErrorMessage('boom')).toBe('boom')
  })
})
