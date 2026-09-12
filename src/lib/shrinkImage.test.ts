import { describe, expect, test } from 'vitest'
import { canShrink, shrunkFileName } from './shrinkImage'

describe('shrunkFileName', () => {
  test('swaps the extension for the one it writes', () => {
    expect(shrunkFileName('clipboard-20260912-153045.png')).toBe(
      'clipboard-20260912-153045.jpg',
    )
  })

  test('adds the extension when the name has none', () => {
    expect(shrunkFileName('clipboard')).toBe('clipboard.jpg')
  })

  test('only replaces the last extension', () => {
    expect(shrunkFileName('a.b.png')).toBe('a.b.jpg')
  })

  test('keeps a name that is already the target extension', () => {
    expect(shrunkFileName('photo.jpg')).toBe('photo.jpg')
  })
})

describe('canShrink', () => {
  function file(type: string, name = 'x'): File {
    return new File([], name, { type })
  }

  test('shrinks raster images', () => {
    expect(canShrink(file('image/png'))).toBe(true)
    expect(canShrink(file('image/jpeg'))).toBe(true)
    expect(canShrink(file('image/webp'))).toBe(true)
  })

  test('refuses gif — canvas に描き直すとコマ 1 枚の静止画になる', () => {
    expect(canShrink(file('image/gif'))).toBe(false)
    expect(canShrink(file('IMAGE/GIF'))).toBe(false)
  })

  test('refuses everything that is not an image', () => {
    expect(canShrink(file('video/mp4'))).toBe(false)
    expect(canShrink(file('audio/mpeg'))).toBe(false)
    expect(canShrink(file('application/pdf'))).toBe(false)
    expect(canShrink(file('text/plain'))).toBe(false)
    expect(canShrink(file(''))).toBe(false)
  })
})
