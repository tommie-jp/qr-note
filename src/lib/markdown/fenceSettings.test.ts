import { describe, expect, test } from 'vitest'
import { fenceSettings, splitFenceSource } from './fenceSettings'

describe('splitFenceSource', () => {
  test('1 行目を検索式、残りを設定の行に割る', () => {
    expect(splitFenceSource('#tag \r\nsort=title\ncol=a')).toEqual({
      query: '#tag',
      settingLines: ['sort=title', 'col=a'],
    })
  })

  test('空の本文は空の検索式になる', () => {
    expect(splitFenceSource('')).toEqual({ query: '', settingLines: [] })
  })
})

describe('fenceSettings', () => {
  test('空行を飛ばし、キーだけ畳んで値は打ったまま返す', () => {
    expect([...fenceSettings(['', ' ＳＯＲＴ ＝ 🈚 ', 'col=a=b'])]).toEqual([
      { key: 'sort', value: '🈚' },
      { key: 'col', value: 'a=b' },
    ])
  })

  test('区切りの無い行・キーの無い行はエラーとして返す', () => {
    expect([...fenceSettings(['abc', '=x'])]).toEqual([
      { error: '設定は「キー=値」の形で書きます: 「abc」' },
      { error: '設定は「キー=値」の形で書きます: 「=x」' },
    ])
  })

  test('1 行ずつ読むので、先の行で止めれば後の行は読まない', () => {
    const lines = ['a=1', 'bad']
    const iterator = fenceSettings(lines)
    expect(iterator.next().value).toEqual({ key: 'a', value: '1' })
    lines[1] = 'b=2'
    expect(iterator.next().value).toEqual({ key: 'b', value: '2' })
  })
})
