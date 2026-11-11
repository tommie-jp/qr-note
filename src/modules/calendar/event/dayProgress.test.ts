import { describe, expect, test } from 'vitest'
import { dayProgress } from './dayProgress'

const ev = (done?: boolean) => ({ done })

describe('dayProgress (日付の右の ✓ / 残n、docs/126 §1-21)', () => {
  test('予定が無い日は何も出さない', () => {
    expect(dayProgress([])).toBeNull()
  })

  test('すべて済みなら done', () => {
    expect(dayProgress([ev(true), ev(true)])).toEqual({ kind: 'done' })
  })

  test('済みでない予定があれば、その数を残す (done 無しの古い応答は未済)', () => {
    expect(dayProgress([ev(true), ev(false), ev()])).toEqual({ kind: 'left', count: 2 })
  })
})
