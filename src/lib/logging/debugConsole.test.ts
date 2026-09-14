import { expect, test } from 'vitest'
import { debugEnabledFor } from './debugConsole'

// eruda の出し入れの判断 (docs/30-ブラウザログ計画.md §5)。
// 本体の読み込み (logging/erudaConsole.ts) はブラウザが無いと動かないので、
// ここでは判断だけを見る。パネルが実際に出ることは実機で確かめる

test('?debug=1 で出す', () => {
  expect(debugEnabledFor('?debug=1', false)).toBe(true)
})

test('?debug=0 で消す (覚えている印より URL が強い)', () => {
  expect(debugEnabledFor('?debug=0', true)).toBe(false)
})

test('指示が無ければ覚えている印を継ぐ (SPA 遷移でクエリが消えても出続ける)', () => {
  expect(debugEnabledFor('', true)).toBe(true)
  expect(debugEnabledFor('?q=%23BJT', true)).toBe(true)
  expect(debugEnabledFor('?q=%23BJT', false)).toBe(false)
})

test('debug の値が 1 / 0 以外なら指示として扱わない', () => {
  expect(debugEnabledFor('?debug=yes', false)).toBe(false)
  expect(debugEnabledFor('?debug=yes', true)).toBe(true)
})
