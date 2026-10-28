import { describe, expect, test, vi } from 'vitest'

// 表示の切替に載せる区分 (docs/120 §2)。clientCapture は使わないので差し替える
vi.mock('./clientCapture', () => ({ queueClientLog: () => {} }))

const { perfSetViewPhase, withViewPhase } = await import('./perfClient')

describe('withViewPhase', () => {
  test('置かれた区分を、表示の切替の項目の最後に足す', () => {
    perfSetViewPhase('測定')

    expect(withViewPhase('表示', [['切替', 'compact→medium']])).toEqual([
      ['切替', 'compact→medium'],
      ['区分', '測定'],
    ])
  })

  test('区分は 1 回だけ使われる (普段どおり押した切替には付かない)', () => {
    perfSetViewPhase('戻し')
    withViewPhase('表示', [['切替', 'a→b']])

    expect(withViewPhase('表示', [['切替', 'b→c']])).toEqual([['切替', 'b→c']])
  })

  test('表示以外の計測は区分を読まず、置かれた区分も消さない', () => {
    perfSetViewPhase('揃え')

    expect(withViewPhase('検索', undefined)).toBeUndefined()
    expect(withViewPhase('表示', [])).toEqual([['区分', '揃え']])
  })

  test('区分も項目も無ければ undefined のまま', () => {
    perfSetViewPhase(null)

    expect(withViewPhase('表示', undefined)).toBeUndefined()
  })
})
