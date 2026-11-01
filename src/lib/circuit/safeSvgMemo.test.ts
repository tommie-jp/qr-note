import { describe, expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { createSafeSvgMemo } = await import('./safeSvgMemo')

// 回路図 SVG の検査の控え (docs/123 §12-7)
describe('createSafeSvgMemo', () => {
  test('同じ中身は 2 度目から検査せず、組み直した文字列を返す', () => {
    // Arrange
    const verify = vi.fn((svg: string) => `safe:${svg}`)
    const memo = createSafeSvgMemo(verify)

    // Act
    const first = memo.check('<svg>a</svg>')
    const second = memo.check('<svg>a</svg>')

    // Assert
    expect(first).toBe('safe:<svg>a</svg>')
    expect(second).toBe(first)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  test('中身が 1 文字でも違えば検査し直す (DB の書き換えを見逃さない)', () => {
    const verify = vi.fn((svg: string) => svg)
    const memo = createSafeSvgMemo(verify)

    memo.check('<svg>a</svg>')
    memo.check('<svg>b</svg>')

    expect(verify).toHaveBeenCalledTimes(2)
  })

  test('通らない中身は覚えず、毎回検査して投げる', () => {
    const verify = vi.fn(() => {
      throw new Error('危ない')
    })
    const memo = createSafeSvgMemo(verify)

    expect(() => memo.check('<svg onload="x"/>')).toThrow('危ない')
    expect(() => memo.check('<svg onload="x"/>')).toThrow('危ない')
    expect(verify).toHaveBeenCalledTimes(2)
    expect(memo.size()).toEqual({ entries: 0, chars: 0 })
  })

  test('上限を超えたら長く使っていない物から捨てる', () => {
    // Arrange: 1 枚 10 文字、上限 25 文字 (2 枚まで)
    const verify = vi.fn((svg: string) => svg)
    const memo = createSafeSvgMemo(verify, 25)
    memo.check('aaaaaaaaaa')
    memo.check('bbbbbbbbbb')
    // a を使い直す (後ろへ回る)
    memo.check('aaaaaaaaaa')

    // Act: 3 枚目で b が押し出される
    memo.check('cccccccccc')

    // Assert
    expect(memo.size()).toEqual({ entries: 2, chars: 20 })
    verify.mockClear()
    memo.check('aaaaaaaaaa')
    expect(verify).not.toHaveBeenCalled()
    memo.check('bbbbbbbbbb')
    expect(verify).toHaveBeenCalledTimes(1)
  })

  test('上限より大きい 1 枚は覚えずに返す', () => {
    const verify = vi.fn((svg: string) => svg)
    const memo = createSafeSvgMemo(verify, 5)

    expect(memo.check('0123456789')).toBe('0123456789')
    expect(memo.size()).toEqual({ entries: 0, chars: 0 })
  })
})
