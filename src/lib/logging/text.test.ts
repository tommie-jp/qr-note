import { expect, test } from 'vitest'
import { formatLogArg, formatLogArgs } from './text'
import { LOG_TEXT_LIMIT } from './entry'

// ログの整形 (docs/21-ログ表示計画.md §2、docs/30-ブラウザログ計画.md §1)

test('文字列はそのまま、Error は message を採る', () => {
  expect(formatLogArg('書影を取得できませんでした')).toBe('書影を取得できませんでした')
  expect(formatLogArg(new Error('HTTP 503'))).toBe('HTTP 503')
})

test('オブジェクトは JSON、文字列化に失敗する値は String() に落とす', () => {
  expect(formatLogArg({ count: 0 })).toBe('{"count":0}')

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(formatLogArg(cyclic)).toContain('object')
})

// WASM (onnxruntime / OpenCV) は色付きで stderr に書く。エスケープを残すと
// 画面に [0;93m のような文字が並び、肝心の本文が読めなくなる (実機で確認)
test('ANSI のエスケープを落とす', () => {
  const colored = '[0;93m2026-07-19 [W:onnxruntime:] Removing initializer[m'

  expect(formatLogArg(colored)).toBe('2026-07-19 [W:onnxruntime:] Removing initializer')
})

test('ANSI を落としても、角括弧を含む普通の本文は残る', () => {
  // [W:onnxruntime:] のような「エスケープでない角括弧」を巻き添えにしない
  expect(formatLogArg('[warn] 取得に失敗 (isbn=978…)')).toBe('[warn] 取得に失敗 (isbn=978…)')
})

test('複数の引数は空白で繋ぎ、2000 文字で切る', () => {
  expect(formatLogArgs(['応答:', { count: 0 }])).toBe('応答: {"count":0}')
  expect(formatLogArgs(['あ'.repeat(LOG_TEXT_LIMIT + 100)])).toHaveLength(LOG_TEXT_LIMIT)
})
