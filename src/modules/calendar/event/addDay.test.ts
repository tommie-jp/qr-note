import { describe, expect, test } from 'vitest'
import { dayToAdd } from './addDay'

describe('dayToAdd (検索窓の＋で予定を足す日)', () => {
  test('選んだ日があればその日 (前後の月のマスでも)', () => {
    expect(dayToAdd('2026-11-20', '2026-11', '2026-11-11')).toBe('2026-11-20')
    expect(dayToAdd('2026-10-27', '2026-11', '2026-11-11')).toBe('2026-10-27')
  })

  test('選んでいなければ、見ている月が今月なら今日', () => {
    expect(dayToAdd(null, '2026-11', '2026-11-11')).toBe('2026-11-11')
  })

  test('選んでいなくて別の月を見ているなら、その月の 1 日', () => {
    expect(dayToAdd(null, '2027-02', '2026-11-11')).toBe('2027-02-01')
  })
})
