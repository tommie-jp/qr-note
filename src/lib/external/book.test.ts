import { expect, test } from 'vitest'
import { formatPubdate } from './book'

test('刊行日は年月まで (日は落とす)', () => {
  // 版を見分けるのが目的なので日まではいらない
  expect(formatPubdate('201206')).toBe('2012.06')
  expect(formatPubdate('20120621')).toBe('2012.06')
})

test('NDL の 0 埋めしない月 ("2012.6") を落とさない', () => {
  // NDL の dcterms:date は "2012.6" / "1996.2" 形式。数字だけを抜き出して
  // 桁数で判断すると 5 桁になり、刊行年月が丸ごと消える (実測で踏んだ)
  expect(formatPubdate('2012.6')).toBe('2012.06')
  expect(formatPubdate('1996.2')).toBe('1996.02')
})

test('区切り文字は形式が揺れるので当てにしない', () => {
  expect(formatPubdate('2012-06')).toBe('2012.06')
  expect(formatPubdate('2012-06-21')).toBe('2012.06')
  expect(formatPubdate('2012.06.21')).toBe('2012.06')
  expect(formatPubdate('2012年6月')).toBe('2012.06')
})

test('刊行日が年だけならそのまま', () => {
  expect(formatPubdate('2012')).toBe('2012')
})

test('読めない刊行日は空', () => {
  expect(formatPubdate('')).toBe('')
  expect(formatPubdate('近日刊行')).toBe('')
  expect(formatPubdate('[出版年不明]')).toBe('')
})
