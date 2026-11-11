import { describe, expect, test } from 'vitest'
import { PANE_SIDE_PADDING_INIT_SCRIPT } from './paneSidePadding'

// 先回りスクリプトを素の関数として走らせ、html に当たる値を見る
function run(stored: string | null): string | undefined {
  const set: Record<string, string> = {}
  const localStorage = { getItem: () => stored }
  const document = { documentElement: { style: { setProperty: (k: string, v: string) => (set[k] = v) } } }
  new Function('localStorage', 'document', PANE_SIDE_PADDING_INIT_SCRIPT)(localStorage, document)
  return set['--pane-side-pad']
}

describe('PANE_SIDE_PADDING_INIT_SCRIPT (ペインの左右の余白、docs/86 §4-20)', () => {
  test('覚えた px をそのまま当てる', () => {
    expect(run('0')).toBe('0px')
    expect(run('8')).toBe('8px')
  })

  test('範囲外は端へ寄せ、無い・読めない値は何も書かない (CSS の既定 1rem)', () => {
    expect(run('40')).toBe('16px')
    expect(run(null)).toBeUndefined()
    expect(run('abc')).toBeUndefined()
  })
})
