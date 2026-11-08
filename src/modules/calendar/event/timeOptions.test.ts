import { describe, expect, test } from 'vitest'
import { moveStart, quarterHours } from './timeOptions'

describe('quarterHours', () => {
  test('00:00 から 23:45 まで 15 分刻みの 96 個', () => {
    const list = quarterHours()
    expect(list).toHaveLength(96)
    expect(list.slice(0, 3)).toEqual(['00:00', '00:15', '00:30'])
    expect(list.at(-1)).toBe('23:45')
  })

  test('刻みに乗らないいまの値も入れて並べる (選んでいる値が欄から消えない)', () => {
    const list = quarterHours('10:10')
    expect(list).toHaveLength(97)
    expect(list.slice(list.indexOf('10:00'), list.indexOf('10:00') + 3)).toEqual(['10:00', '10:10', '10:15'])
  })
})

describe('moveStart', () => {
  test('長さを保って終わりも動かす', () => {
    expect(moveStart({ start: '10:00', end: '11:30' }, '13:15')).toEqual({ start: '13:15', end: '14:45' })
  })

  test('終わりが無い (1 時間) ならそのまま', () => {
    expect(moveStart({ start: '10:00', end: null }, '13:00')).toEqual({ start: '13:00', end: null })
  })

  test('動かした終わりが日をまたぐなら終わりを外す (1 時間)', () => {
    expect(moveStart({ start: '10:00', end: '12:00' }, '23:00')).toEqual({ start: '23:00', end: null })
  })
})
