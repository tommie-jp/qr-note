import { describe, expect, test } from 'vitest'
import {
  findAnswerSpoilers,
  hasAnswerSpoiler,
  stripAnswerSpoilers,
} from './answerSpoiler'

const answers = (text: string) =>
  findAnswerSpoilers(text).map((match) => match.answer)

describe('findAnswerSpoilers', () => {
  test('`||答え||` を拾う', () => {
    expect(answers('infect ||動 ～に感染させる||')).toEqual([
      '動 ～に感染させる',
    ])
  })

  test('1 行に複数あっても拾う', () => {
    expect(answers('a ||1|| b ||2||')).toEqual(['1', '2'])
  })

  test('置換に使う位置と長さを返す', () => {
    const [hit] = findAnswerSpoilers('infect ||訳||')
    expect('infect ||訳||'.slice(hit.start, hit.start + hit.length)).toBe(
      '||訳||',
    )
  })

  // 中に `|` を許すと表の記法と見分けが付かない
  test('答えに | は書けない', () => {
    expect(answers('||a|b||')).toEqual([])
  })

  test('空 (||||) は記法にしない', () => {
    expect(answers('||||')).toEqual([])
  })

  test('閉じていない `||` は文字のまま', () => {
    expect(answers('infect ||訳')).toEqual([])
  })

  test('改行は跨がない', () => {
    expect(answers('||訳\n例文||')).toEqual([])
  })

  test('表の空セルを誤って拾わない (1 つの `||` だけ)', () => {
    expect(answers('| a || b |')).toEqual([])
  })
})

describe('stripAnswerSpoilers', () => {
  test('答えを丸ごと落とす', () => {
    expect(stripAnswerSpoilers('infect ||動 ～に感染させる||')).toBe('infect ')
  })

  test('記法が無ければそのまま', () => {
    expect(stripAnswerSpoilers('ふつうの本文')).toBe('ふつうの本文')
  })
})

describe('hasAnswerSpoiler', () => {
  test('あれば true', () => {
    expect(hasAnswerSpoiler('- [ ] infect ||訳||')).toBe(true)
  })

  test('無ければ false', () => {
    expect(hasAnswerSpoiler('- [ ] infect')).toBe(false)
    expect(hasAnswerSpoiler('| a || b |')).toBe(false)
  })
})
