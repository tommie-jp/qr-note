import { afterEach, describe, expect, test, vi } from 'vitest'
import { canCopyImage, canWriteImage, needsPngConversion } from './clipboardImage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('needsPngConversion', () => {
  test('passes a png through untouched', () => {
    expect(needsPngConversion('image/png')).toBe(false)
  })

  test('converts everything else — Chrome の write は png しか受けない', () => {
    expect(needsPngConversion('image/webp')).toBe(true)
    expect(needsPngConversion('image/jpeg')).toBe(true)
    expect(needsPngConversion('')).toBe(true)
  })

  test('ignores parameters and case in the mime', () => {
    expect(needsPngConversion('IMAGE/PNG')).toBe(false)
    expect(needsPngConversion('image/png; charset=binary')).toBe(false)
  })
})

describe('canWriteImage', () => {
  test('is false where ClipboardItem is missing (node, 古い Safari)', () => {
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.resolve() } })
    expect(canWriteImage()).toBe(false)
  })

  test('is false where clipboard.write is missing (secure context の外)', () => {
    vi.stubGlobal('ClipboardItem', class {})
    vi.stubGlobal('navigator', { clipboard: {} })
    expect(canWriteImage()).toBe(false)
  })

  test('is false where there is no clipboard at all', () => {
    vi.stubGlobal('ClipboardItem', class {})
    vi.stubGlobal('navigator', {})
    expect(canWriteImage()).toBe(false)
  })

  test('is true when both halves are there', () => {
    vi.stubGlobal('ClipboardItem', class {})
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.resolve() } })
    expect(canWriteImage()).toBe(true)
  })
})

describe('canCopyImage', () => {
  function withClipboard() {
    vi.stubGlobal('ClipboardItem', class {})
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.resolve() } })
  }

  test('offers the button for a stored attachment', () => {
    withClipboard()
    expect(canCopyImage('/api/images/2a0acfad.png')).toBe(true)
  })

  // 復号したシークレット断片の中身は blob: で描かれる (docs/51 §3)。平文を
  // OS のクリップボード (同期先・履歴) へ 1 タップで送れる口を付けない
  test('never offers it for a blob: url (復号したシークレットの平文)', () => {
    withClipboard()
    expect(canCopyImage('blob:http://localhost:3210/8f0e-…')).toBe(false)
  })

  test('stays hidden where the clipboard cannot take an image at all', () => {
    expect(canCopyImage('/api/images/2a0acfad.png')).toBe(false)
  })
})
