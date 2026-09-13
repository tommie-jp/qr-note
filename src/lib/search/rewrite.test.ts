import { describe, expect, test } from 'vitest'
import { and, not, or, t, tag, task } from '@/test/searchExpr'
import { parseSearchExpr } from './parse'
import {
  narrowToChecks,
  queryHasTagTerm,
  queryTracksTaskProgress,
  stripTaskTerms,
} from './rewrite'
import type { SearchExpr } from './types'

describe('queryHasTagTerm', () => {
  test('is true for a tag query', () => {
    expect(queryHasTagTerm('#bjt')).toBe(true)
    expect(queryHasTagTerm('＃ＮＰＮ')).toBe(true)
  })

  test('is true when a tag appears anywhere in positive position', () => {
    expect(queryHasTagTerm('抵抗 OR #bjt')).toBe(true)
    expect(queryHasTagTerm('#bjt 2sc')).toBe(true)
    expect(queryHasTagTerm('(抵抗 OR #bjt) 2sc')).toBe(true)
    expect(queryHasTagTerm('#bjt !#npn')).toBe(true)
  })

  test('is false when the only tag is negated (族の指定にならないため)', () => {
    expect(queryHasTagTerm('!#npn')).toBe(false)
    expect(queryHasTagTerm('抵抗 !#npn')).toBe(false)
  })

  test('is false for a text-only query', () => {
    expect(queryHasTagTerm('抵抗')).toBe(false)
    expect(queryHasTagTerm('抵抗 1608 OR コンデンサ')).toBe(false)
  })

  test('is false for a quoted #tag (a full-text literal, not a tag)', () => {
    expect(queryHasTagTerm('"#bjt"')).toBe(false)
  })

  test('is false for a bare # and for an empty query', () => {
    expect(queryHasTagTerm('#')).toBe(false)
    expect(queryHasTagTerm('')).toBe(false)
    expect(queryHasTagTerm('   ')).toBe(false)
  })
})

// --- 学習進捗の母数を出すための道具 (docs/60-学習進捗計画.md §2) ---

describe('queryTracksTaskProgress', () => {
  test('is true when a check-state term is ANDed at the top level', () => {
    expect(queryTracksTaskProgress('is:todo')).toBe(true)
    expect(queryTracksTaskProgress('#英単語 is:done')).toBe(true)
    expect(queryTracksTaskProgress('#英単語 #難 is:todo')).toBe(true)
  })

  // 母数は「チェック語を外した式」で数えるので、否定でも AND の直下なら
  // 外した式は必ず広がる (= 上位集合になる)
  test('is true when negated at the top level', () => {
    expect(queryTracksTaskProgress('!is:todo')).toBe(true)
    expect(queryTracksTaskProgress('#英単語 !is:todo')).toBe(true)
  })

  // OR の枝から葉を抜くと式は逆に狭まり、母数が結果より小さくなる。
  // 一覧と無関係な数を出すくらいなら出さない
  test('is false when a check-state term sits under an OR', () => {
    expect(queryTracksTaskProgress('#英単語 OR is:todo')).toBe(false)
    expect(queryTracksTaskProgress('(#a OR is:todo) #b')).toBe(false)
    // 最上位に裸のチェック語があっても、OR の枝に潜んでいれば同じく嘘になる
    expect(queryTracksTaskProgress('#a is:done (is:todo OR #難)')).toBe(false)
  })

  test('is false when the check-state term is inside a negated group', () => {
    expect(queryTracksTaskProgress('!(is:todo #難)')).toBe(false)
  })

  test('is false without a check-state term', () => {
    expect(queryTracksTaskProgress('#英単語')).toBe(false)
    expect(queryTracksTaskProgress('')).toBe(false)
  })

  test('is false for a quoted "is:todo" (a full-text literal)', () => {
    expect(queryTracksTaskProgress('"is:todo"')).toBe(false)
  })
})

describe('stripTaskTerms', () => {
  // 「今の検索からチェックの条件だけ外したもの」= 進捗の母数の検索式
  const strip = (query: string): SearchExpr | null => {
    const expr = parseSearchExpr(query)
    return expr === null ? null : stripTaskTerms(expr)
  }

  test('チェック語を落として残りを返す', () => {
    expect(strip('#過渡現象 is:todo')).toEqual(tag('過渡現象'))
    expect(strip('#過渡現象 is:todo is:done')).toEqual(tag('過渡現象'))
  })

  test('チェック語しかなければ null (絞り込みなし = 全ノートが母数)', () => {
    expect(strip('is:todo')).toBeNull()
    expect(strip('is:todo OR is:done')).toBeNull()
  })

  // 被演算子が消えた `!` は否定ごと落とす。残すと「全件除外」に化ける
  // (capTerms が予算切れの葉に対して行うのと同じ判断)
  test('被演算子が消えた否定は否定ごと落とす', () => {
    expect(strip('!is:todo')).toBeNull()
    expect(strip('#英単語 !is:todo')).toEqual(tag('英単語'))
  })

  test('入れ子の中のチェック語も落とす', () => {
    expect(strip('#a (is:todo OR #難)')).toEqual(and(tag('a'), tag('難')))
    expect(strip('(#a is:todo) OR #b')).toEqual(or(tag('a'), tag('b')))
  })

  test('チェック語が無ければそのまま返す', () => {
    expect(strip('#英単語 抵抗')).toEqual(and(tag('英単語'), t('抵抗')))
  })

  // 引用したら task 語ではなくただの語なので、母数の条件にも残る
  test('引用された "is:todo" は落とさない', () => {
    expect(strip('#a "is:todo"')).toEqual(and(tag('a'), t('is:todo')))
  })
})

// 進捗の表 (docs/77-進捗マトリックス計画.md §7) の行リンクが運ぶ検索式。
// 表の行は「検索ヒットのうちチェックを持つノート」なので、素の検索式を渡すと
// 開いた先の前後ナビが表より広い集合を歩き、「次」で表に無いノートへ飛ぶ
describe('narrowToChecks', () => {
  test('「チェックを持つ」を AND で足す', () => {
    expect(narrowToChecks('#電験三種')).toBe(
      '(#電験三種) (is:todo OR is:done)',
    )
  })

  test('空の検索式なら条件だけ (空の q に畳まない)', () => {
    expect(narrowToChecks('')).toBe('is:todo OR is:done')
    expect(narrowToChecks('  \n ')).toBe('is:todo OR is:done')
  })

  // 足した式は items/where.ts の HAS_TASKS (task_todo > 0 OR task_done > 0) と
  // 同じ条件になる。表の SQL と前後ナビの SQL が同じ集合を指す根拠
  test('足す条件は is:todo OR is:done', () => {
    expect(parseSearchExpr(narrowToChecks(''))).toEqual(
      or(task('todo'), task('done')),
    )
  })

  // 優先順位は AND > OR なので、裸で足すと `a OR (b AND チェック)` になり
  // a 側の絞りが消える。括弧で包む
  test('OR の式は括ってから足す (AND のほうが強く結合するため)', () => {
    expect(parseSearchExpr(narrowToChecks('#a OR #b'))).toEqual(
      and(or(tag('a'), tag('b')), or(task('todo'), task('done'))),
    )
  })

  test('既にチェック語がある式にも足す (!is:todo はチェックを持つ保証にならない)', () => {
    expect(parseSearchExpr(narrowToChecks('#a !is:todo'))).toEqual(
      and(
        and(tag('a'), not(task('todo'))),
        or(task('todo'), task('done')),
      ),
    )
  })

  // 壊れた式でも「それらしく」解釈する流儀は保つ (閉じ忘れの括弧は自動クローズ)
  test('括弧を閉じ忘れた式を包んでも壊れない', () => {
    expect(parseSearchExpr(narrowToChecks('(#a'))).toEqual(
      and(tag('a'), or(task('todo'), task('done'))),
    )
  })

  // 閉じ忘れの引用は**行末まで**リテラルなので、そのまま包むと閉じ括弧も
  // 足した条件も引用の中身に食われる。閉じてから包む (意味は変わらない)
  test('引用を閉じ忘れた式でも条件が食われない', () => {
    expect(parseSearchExpr(narrowToChecks('"abc'))).toEqual(
      and(t('abc'), or(task('todo'), task('done'))),
    )
    // 最上位が OR の式でも、閉じたうえで包むので枝が壊れない
    expect(parseSearchExpr(narrowToChecks('#a OR "b c'))).toEqual(
      and(or(tag('a'), t('b c')), or(task('todo'), task('done'))),
    )
  })
})
