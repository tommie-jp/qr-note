import { describe, expect, test } from 'vitest'
import {
  MAX_MATRIX_COLUMNS,
  normalizeCheckLabel,
  parseMatrixFence,
} from './matrixFence'

function spec(source: string) {
  const result = parseMatrixFence(source)
  if ('error' in result) {
    throw new Error(`予期しないエラー: ${result.error}`)
  }
  return result
}

function error(source: string): string {
  const result = parseMatrixFence(source)
  if (!('error' in result)) {
    throw new Error('エラーになるはずが通った')
  }
  return result.error
}

describe('parseMatrixFence', () => {
  test('1 行目を検索式として読む', () => {
    expect(spec('#電験三種 !#後回し').query).toBe('#電験三種 !#後回し')
  })

  test('検索式が空なら絞り込みなし', () => {
    expect(spec('').query).toBe('')
    expect(spec('\nsort=updated').query).toBe('')
  })

  test('並び順の既定は番号順', () => {
    expect(spec('#電験三種').sort).toBe('itemNo')
  })

  test('sort= で並び順を変えられる', () => {
    expect(spec('#電験三種\nsort=updated').sort).toBe('updated')
    expect(spec('#電験三種\nsort=itemNoDesc').sort).toBe('itemNoDesc')
  })

  test('列を省くと空 (状態 1 列)', () => {
    expect(spec('#電験三種').columns).toEqual([])
  })

  test('col= はカンマ区切りで複数取る', () => {
    expect(spec('#電験三種\ncol=学習済み,自信あり').columns).toEqual([
      '学習済み',
      '自信あり',
    ])
  })

  test('列の前後の空白は落とす', () => {
    expect(spec('#電験三種\ncol= 学習済み , 自信あり ').columns).toEqual([
      '学習済み',
      '自信あり',
    ])
  })

  test('オプションの間の空行は読み飛ばす', () => {
    const parsed = spec('#電験三種\n\nsort=title\n\ncol=学習済み\n')
    expect(parsed.sort).toBe('title')
    expect(parsed.columns).toEqual(['学習済み'])
  })

  // 1 行目を「キー=値」として読む実装だと、プロパティ検索の正当な式が壊れる
  test('1 行目の hFE=195 は検索式のまま (設定として読まない)', () => {
    expect(spec('#bjt hFE=195').query).toBe('#bjt hFE=195')
  })

  test('キーの大文字小文字と全角は畳む', () => {
    expect(spec('#電験三種\nSORT=ItemNo').sort).toBe('itemNo')
    expect(spec('#電験三種\nｓｏｒｔ＝ｕｐｄａｔｅｄ').sort).toBe('updated')
  })

  test('知らないキーはエラーにする (黙って無視しない)', () => {
    expect(error('#電験三種\nlimit=10')).toContain('limit')
  })

  test('綴り違いは受け付けず、正しい綴りを教える', () => {
    expect(error('#電験三種\ncols=学習済み')).toContain('col')
    expect(error('#電験三種\ncolumns=学習済み')).toContain('col')
    expect(error('#電験三種\n並び=番号順')).toContain('sort')
  })

  test('= の無い行はエラー', () => {
    expect(error('#電験三種\nsort itemNo')).toContain('キー=値')
  })

  test('SORTS に無い並び順はエラー (黙って既定に畳まない)', () => {
    expect(error('#電験三種\nsort=relevance')).toContain('relevance')
  })

  test('同じキーを 2 回書いたらエラー (後勝ちで黙らせない)', () => {
    expect(error('#電験三種\nsort=title\nsort=updated')).toContain('sort')
  })

  test('列が空ならエラー', () => {
    expect(error('#電験三種\ncol=')).toContain('列')
    expect(error('#電験三種\ncol= , ')).toContain('列')
  })

  test(`列は ${MAX_MATRIX_COLUMNS} つまで`, () => {
    const many = Array.from({ length: MAX_MATRIX_COLUMNS + 1 }, (_, i) => `列${i}`)
    expect(error(`#電験三種\ncol=${many.join(',')}`)).toContain(
      String(MAX_MATRIX_COLUMNS),
    )
  })

  test('CRLF の本文も読める', () => {
    const parsed = spec('#電験三種\r\nsort=title\r\ncol=学習済み')
    expect(parsed.sort).toBe('title')
    expect(parsed.columns).toEqual(['学習済み'])
  })
})

describe('normalizeCheckLabel', () => {
  test('前後の空白を落とす', () => {
    expect(normalizeCheckLabel(' 学習済み ')).toBe('学習済み')
  })

  test('全角英数は半角へ畳む', () => {
    expect(normalizeCheckLabel('ＴＯＤＯ')).toBe(normalizeCheckLabel('todo'))
  })

  test('大文字小文字は同じ', () => {
    expect(normalizeCheckLabel('Done')).toBe(normalizeCheckLabel('done'))
  })
})

describe('parseMatrixFence (列の重複)', () => {
  test('同じ列名を 2 回書いたらエラー', () => {
    expect(error('#電験三種\ncol=学習済み,学習済み')).toContain('学習済み')
  })

  test('照合すると同じになる綴りもエラー', () => {
    expect(error('#電験三種\ncol=TODO,todo')).toContain('todo')
  })
})
