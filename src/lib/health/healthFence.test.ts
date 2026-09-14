import { describe, expect, test } from 'vitest'
import {
  DEFAULT_HEALTH_DAYS,
  MAX_HEALTH_DAYS,
  normalizeMeasureLabel,
  parseHealthFence,
} from './healthFence'

function spec(source: string) {
  const result = parseHealthFence(source)
  if ('error' in result) {
    throw new Error(`予期しないエラー: ${result.error}`)
  }
  return result
}

function error(source: string): string {
  const result = parseHealthFence(source)
  if (!('error' in result)) {
    throw new Error('エラーになるはずが通った')
  }
  return result.error
}

describe('parseHealthFence', () => {
  test('1 行目を検索式として読む', () => {
    expect(spec('#健康管理 !#下書き').query).toBe('#健康管理 !#下書き')
  })

  test('検索式が空なら絞り込みなし', () => {
    expect(spec('').query).toBe('')
    expect(spec('\ndays=90').query).toBe('')
  })

  test('項目を省くと null (本文から拾う)', () => {
    expect(spec('#健康管理').item).toBeNull()
  })

  test('y= で縦軸の項目を選ぶ', () => {
    expect(spec('#健康管理\ny=体重').item).toBe('体重')
  })

  test('項目の前後の空白は落とす', () => {
    expect(spec('#健康管理\ny=  体重  ').item).toBe('体重')
  })

  test('期間の既定は 30 日', () => {
    expect(spec('#健康管理').days).toBe(DEFAULT_HEALTH_DAYS)
  })

  test('days= で期間を変えられる', () => {
    expect(spec('#健康管理\ndays=90').days).toBe(90)
  })

  test('キーの大文字・全角は通す', () => {
    expect(spec('#健康管理\nY=体重').item).toBe('体重')
    expect(spec('#健康管理\nｄａｙｓ＝90').days).toBe(90)
  })

  test('全角の数字も日数として読む', () => {
    expect(spec('#健康管理\ndays=９０').days).toBe(90)
  })

  test('空行は読み飛ばす', () => {
    expect(spec('#健康管理\n\ny=体重\n\n').item).toBe('体重')
  })

  test('項目名は打ったまま持つ (畳まない)', () => {
    // 照合するときだけ normalizeMeasureLabel を通す。ここで畳むと
    // 本文に書いた綴りと違う名前が軸のラベルに出る
    expect(spec('#健康管理\ny=ＢＭＩ').item).toBe('ＢＭＩ')
  })

  test('キー=値 の形でない行はエラー', () => {
    expect(error('#健康管理\n体重')).toContain('キー=値')
  })

  test('項目が空ならエラー', () => {
    expect(error('#健康管理\ny=')).toContain('項目')
  })

  test('同じキーを 2 回書いたらエラー', () => {
    expect(error('#健康管理\ny=体重\ny=体温')).toContain('2 回')
    expect(error('#健康管理\ndays=30\ndays=60')).toContain('2 回')
  })

  test('日数が数値でなければエラー', () => {
    expect(error('#健康管理\ndays=1ヶ月')).toContain('日数')
  })

  test('日数の範囲外はエラー', () => {
    expect(error('#健康管理\ndays=0')).toContain('日数')
    expect(error(`#健康管理\ndays=${MAX_HEALTH_DAYS + 1}`)).toContain(
      String(MAX_HEALTH_DAYS),
    )
  })

  test('小数の日数はエラー (黙って切り捨てない)', () => {
    expect(error('#健康管理\ndays=30.5')).toContain('日数')
  })

  test('知らないキーはエラーにする (黙って無視しない)', () => {
    expect(error('#健康管理\nsort=updated')).toContain('sort')
  })

  test('綴りが近いキーは候補を出す', () => {
    expect(error('#健康管理\nday=30')).toContain('days=')
    expect(error('#健康管理\n項目=体重')).toContain('y=')
    expect(error('#健康管理\n期間=30')).toContain('days=')
  })
})

describe('normalizeMeasureLabel', () => {
  test('全角・大文字・前後の空白の違いを吸収する', () => {
    expect(normalizeMeasureLabel(' ＢＭＩ ')).toBe(normalizeMeasureLabel('bmi'))
  })

  test('違う名前は畳まない', () => {
    expect(normalizeMeasureLabel('体重')).not.toBe(normalizeMeasureLabel('体温'))
  })
})
