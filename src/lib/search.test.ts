import { describe, expect, test } from 'vitest'
import {
  MAX_SEARCH_TERMS,
  narrowToChecks,
  parseSearchExpr,
  queryHasTagTerm,
  queryTracksTaskProgress,
  stripTaskTerms,
  type SearchExpr,
} from './search'

// テストを読みやすくするための AST ビルダ。
const t = (value: string): SearchExpr => ({
  op: 'term',
  term: { kind: 'text', value },
})
const tag = (value: string): SearchExpr => ({
  op: 'term',
  term: { kind: 'tag', value },
})
const and = (...children: SearchExpr[]): SearchExpr => ({ op: 'and', children })
const or = (...children: SearchExpr[]): SearchExpr => ({ op: 'or', children })
const not = (child: SearchExpr): SearchExpr => ({ op: 'not', child })

describe('parseSearchExpr', () => {
  test('a single term is a bare leaf (no wrapper node)', () => {
    expect(parseSearchExpr('ライト')).toEqual(t('ライト'))
  })

  test('empty / whitespace-only input yields null (絞り込みなし)', () => {
    expect(parseSearchExpr('')).toBeNull()
    expect(parseSearchExpr('   　 ')).toBeNull()
  })

  describe('space = implicit AND', () => {
    test('splits on a half-width space', () => {
      expect(parseSearchExpr('抵抗 1608')).toEqual(and(t('抵抗'), t('1608')))
    })

    test('splits on a full-width space (全角スペース)', () => {
      expect(parseSearchExpr('ライト　RITEX')).toEqual(and(t('ライト'), t('RITEX')))
    })

    test('collapses consecutive and mixed whitespace', () => {
      expect(parseSearchExpr('  抵抗　　\t1608  ')).toEqual(and(t('抵抗'), t('1608')))
    })
  })

  describe('OR keyword', () => {
    test('joins two terms', () => {
      expect(parseSearchExpr('抵抗 OR コンデンサ')).toEqual(
        or(t('抵抗'), t('コンデンサ')),
      )
    })

    test('joins three terms into one flat node', () => {
      expect(parseSearchExpr('A OR B OR C')).toEqual(or(t('A'), t('B'), t('C')))
    })

    test('is case-insensitive (or / Or / oR)', () => {
      expect(parseSearchExpr('a or b')).toEqual(or(t('a'), t('b')))
      expect(parseSearchExpr('a Or b')).toEqual(or(t('a'), t('b')))
      expect(parseSearchExpr('a oR b')).toEqual(or(t('a'), t('b')))
    })

    test('accepts the full-width ＯＲ (全角のまま打っても演算子)', () => {
      expect(parseSearchExpr('a ＯＲ b')).toEqual(or(t('a'), t('b')))
      expect(parseSearchExpr('#a ｏｒ #b')).toEqual(or(tag('a'), tag('b')))
    })

    test('a quoted "ＯＲ" stays a literal term', () => {
      expect(parseSearchExpr('"ＯＲ"')).toEqual(t('ＯＲ'))
    })

    test('space binds tighter than OR (space=AND, OR looser)', () => {
      expect(parseSearchExpr('抵抗 1608 OR コンデンサ')).toEqual(
        or(and(t('抵抗'), t('1608')), t('コンデンサ')),
      )
    })

    test('drops empty operands (A OR / OR A)', () => {
      expect(parseSearchExpr('A OR')).toEqual(t('A'))
      expect(parseSearchExpr('OR A')).toEqual(t('A'))
      expect(parseSearchExpr('A OR OR B')).toEqual(or(t('A'), t('B')))
    })
  })

  describe('pipe operator', () => {
    test('splits without surrounding spaces', () => {
      expect(parseSearchExpr('A|B')).toEqual(or(t('A'), t('B')))
    })

    test('splits three terms', () => {
      expect(parseSearchExpr('A|B|C')).toEqual(or(t('A'), t('B'), t('C')))
    })

    test('splits with surrounding spaces too', () => {
      expect(parseSearchExpr('A | B')).toEqual(or(t('A'), t('B')))
    })

    test('accepts the full-width ｜', () => {
      expect(parseSearchExpr('A｜B')).toEqual(or(t('A'), t('B')))
      expect(parseSearchExpr('#a｜#b')).toEqual(or(tag('a'), tag('b')))
      expect(parseSearchExpr('A ｜ B')).toEqual(or(t('A'), t('B')))
    })

    test('a quoted full-width ｜ stays a literal', () => {
      expect(parseSearchExpr('"A｜B"')).toEqual(t('A｜B'))
    })

    test('drops empty operands (A||B, |A, A|)', () => {
      expect(parseSearchExpr('A||B')).toEqual(or(t('A'), t('B')))
      expect(parseSearchExpr('|A')).toEqual(t('A'))
      expect(parseSearchExpr('A|')).toEqual(t('A'))
    })

    test('mixes with space-AND', () => {
      expect(parseSearchExpr('抵抗 1608|コンデンサ')).toEqual(
        or(and(t('抵抗'), t('1608')), t('コンデンサ')),
      )
    })
  })

  describe('NOT operator (!)', () => {
    test('negates the following term', () => {
      expect(parseSearchExpr('!#npn')).toEqual(not(tag('npn')))
    })

    test('a space between ! and its operand is allowed', () => {
      expect(parseSearchExpr('! #npn')).toEqual(not(tag('npn')))
    })

    test('binds to one operand only, not the whole AND-group', () => {
      expect(parseSearchExpr('#bjt !#npn')).toEqual(and(tag('bjt'), not(tag('npn'))))
      expect(parseSearchExpr('#bjt ! #npn')).toEqual(and(tag('bjt'), not(tag('npn'))))
      expect(parseSearchExpr('!A B')).toEqual(and(not(t('A')), t('B')))
    })

    test('binds tighter than OR', () => {
      expect(parseSearchExpr('!A OR B')).toEqual(or(not(t('A')), t('B')))
    })

    test('negates a parenthesized group', () => {
      expect(parseSearchExpr('#bjt !(#npn OR #pnp)')).toEqual(
        and(tag('bjt'), not(or(tag('npn'), tag('pnp')))),
      )
    })

    test('accepts the full-width ！', () => {
      expect(parseSearchExpr('！#npn')).toEqual(not(tag('npn')))
    })

    test('double negation cancels out', () => {
      expect(parseSearchExpr('!!A')).toEqual(t('A'))
      expect(parseSearchExpr('!!!A')).toEqual(not(t('A')))
    })

    test('is a literal character when not at the start of a token', () => {
      expect(parseSearchExpr('a!b')).toEqual(t('a!b'))
      expect(parseSearchExpr('A!')).toEqual(t('A!'))
    })

    test('a quoted "!" is a literal term', () => {
      expect(parseSearchExpr('"!"')).toEqual(t('!'))
      expect(parseSearchExpr('"!npn"')).toEqual(t('!npn'))
    })

    test('negates a quoted literal (引用は ! の被演算子になる)', () => {
      // `"or"` と違い `!` はトークンの外にあるので、引用は否定を抑止しない。
      // これが演算子語を否定する唯一の書き方 (docs/16 §4)。
      expect(parseSearchExpr('!"or"')).toEqual(not(t('or')))
      expect(parseSearchExpr('!"#tag1"')).toEqual(not(t('#tag1')))
      expect(parseSearchExpr('!"!foo"')).toEqual(not(t('!foo')))
    })

    test('a ! with no operand is ignored', () => {
      expect(parseSearchExpr('!')).toBeNull()
      expect(parseSearchExpr('A !')).toEqual(t('A'))
      expect(parseSearchExpr('!#')).toBeNull() // 否定つきの空タグ
    })

    test('a ! before the OR operator is ignored (OR は被演算子にならない)', () => {
      // 素の `or` は常に演算子。語として否定したいときは `!"or"`。
      expect(parseSearchExpr('!or')).toBeNull()
      expect(parseSearchExpr('A !or B')).toEqual(or(t('A'), t('B')))
    })
  })

  describe('parentheses', () => {
    test('groups an OR so that AND applies to the whole group', () => {
      expect(parseSearchExpr('(抵抗 OR コンデンサ) 1608')).toEqual(
        and(or(t('抵抗'), t('コンデンサ')), t('1608')),
      )
    })

    test('needs no surrounding spaces', () => {
      expect(parseSearchExpr('#bjt(!#npn)')).toEqual(and(tag('bjt'), not(tag('npn'))))
    })

    test('redundant parens collapse away', () => {
      expect(parseSearchExpr('(A)')).toEqual(t('A'))
      expect(parseSearchExpr('#bjt (!#npn)')).toEqual(and(tag('bjt'), not(tag('npn'))))
    })

    test('nests', () => {
      expect(parseSearchExpr('(A (B OR C))')).toEqual(and(t('A'), or(t('B'), t('C'))))
    })

    test('accepts full-width （）', () => {
      expect(parseSearchExpr('（#a OR #b）')).toEqual(or(tag('a'), tag('b')))
    })

    test('a quoted paren is a literal term', () => {
      expect(parseSearchExpr('"("')).toEqual(t('('))
      expect(parseSearchExpr('"(株)"')).toEqual(t('(株)'))
    })

    describe('tolerant recovery (壊れた入力でもそれらしく解釈する)', () => {
      test('an unclosed ( is auto-closed at the end of input', () => {
        expect(parseSearchExpr('(A B')).toEqual(and(t('A'), t('B')))
        expect(parseSearchExpr('A (B OR C')).toEqual(and(t('A'), or(t('B'), t('C'))))
      })

      test('an unmatched ) is ignored', () => {
        expect(parseSearchExpr('A)')).toEqual(t('A'))
        expect(parseSearchExpr('A) B')).toEqual(and(t('A'), t('B')))
      })

      test('an empty group is ignored', () => {
        expect(parseSearchExpr('()')).toBeNull()
        expect(parseSearchExpr('!()')).toBeNull()
        expect(parseSearchExpr('A ()')).toEqual(t('A'))
      })
    })
  })

  describe('double-quoted literals', () => {
    test('"or" is a literal term, not the OR operator', () => {
      expect(parseSearchExpr('"or"')).toEqual(t('or'))
    })

    test('quoted "or" inside an AND-group stays literal', () => {
      expect(parseSearchExpr('A "or" B')).toEqual(and(t('A'), t('or'), t('B')))
    })

    test('quotes protect a pipe inside the term', () => {
      expect(parseSearchExpr('"A|B"')).toEqual(t('A|B'))
    })

    test('quotes protect whitespace (single term with a space)', () => {
      expect(parseSearchExpr('"A B"')).toEqual(t('A B'))
    })

    test('an unterminated quote runs to the end of input', () => {
      expect(parseSearchExpr('"or')).toEqual(t('or'))
    })

    test('OR still works alongside quoted literals', () => {
      expect(parseSearchExpr('"or" OR "and"')).toEqual(or(t('or'), t('and')))
    })
  })

  describe('tag terms', () => {
    test('an unquoted #tag becomes a tag term', () => {
      expect(parseSearchExpr('#抵抗')).toEqual(tag('抵抗'))
    })

    test('AND of two tags', () => {
      expect(parseSearchExpr('#tag1 #tag2')).toEqual(and(tag('tag1'), tag('tag2')))
    })

    test('OR of two tags (| and OR)', () => {
      expect(parseSearchExpr('#tag1 | #tag2')).toEqual(or(tag('tag1'), tag('tag2')))
      expect(parseSearchExpr('#tag1 OR #tag2')).toEqual(or(tag('tag1'), tag('tag2')))
    })

    test('normalizes the tag name (full-width, case)', () => {
      expect(parseSearchExpr('#ＮＰＮ')).toEqual(tag('npn'))
    })

    test('mixes a tag with a full-text term', () => {
      expect(parseSearchExpr('#トランジスタ 2SC1815')).toEqual(
        and(tag('トランジスタ'), t('2SC1815')),
      )
    })

    test('a quoted "#tag" stays a literal full-text term', () => {
      expect(parseSearchExpr('"#tag1"')).toEqual(t('#tag1'))
    })

    test('a quoted "#" stays a literal full-text term', () => {
      expect(parseSearchExpr('"#"')).toEqual(t('#'))
    })

    test('an unquoted bare # is ignored', () => {
      expect(parseSearchExpr('#')).toBeNull()
      expect(parseSearchExpr('抵抗 #')).toEqual(t('抵抗'))
    })

    test('a tag and the same-named text term are distinct', () => {
      expect(parseSearchExpr('#抵抗 "抵抗"')).toEqual(and(tag('抵抗'), t('抵抗')))
    })
  })

  describe('normalization', () => {
    test('de-duplicates terms within an AND-group', () => {
      expect(parseSearchExpr('ライト ライト')).toEqual(t('ライト'))
      expect(parseSearchExpr('ライト ライト OR B')).toEqual(or(t('ライト'), t('B')))
    })

    test('de-duplicates identical OR operands', () => {
      expect(parseSearchExpr('A OR A')).toEqual(t('A'))
    })

    test('de-duplicates structurally identical sub-expressions', () => {
      expect(parseSearchExpr('!A !A')).toEqual(not(t('A')))
      expect(parseSearchExpr('(A OR B) (A OR B)')).toEqual(or(t('A'), t('B')))
    })

    test('keeps a term and its negation apart', () => {
      expect(parseSearchExpr('A !A')).toEqual(and(t('A'), not(t('A'))))
    })

    test('caps the total number of terms to MAX_SEARCH_TERMS', () => {
      const countTerms = (expr: SearchExpr | null): number => {
        if (expr === null) return 0
        if (expr.op === 'term') return 1
        if (expr.op === 'not') return countTerms(expr.child)
        return expr.children.reduce((n, c) => n + countTerms(c), 0)
      }
      const ored = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' OR ')
      expect(countTerms(parseSearchExpr(ored))).toBe(MAX_SEARCH_TERMS)
      const anded = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
      expect(countTerms(parseSearchExpr(anded))).toBe(MAX_SEARCH_TERMS)
    })
  })
})

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

// --- チェック状態の絞り込み (docs/56-チェック検索計画.md §5) ---

const task = (value: 'todo' | 'done'): SearchExpr => ({
  op: 'term',
  term: { kind: 'task', value },
})

describe('is:todo / is:done', () => {
  test('is:todo / is:done は task 語になる', () => {
    expect(parseSearchExpr('is:todo')).toEqual(task('todo'))
    expect(parseSearchExpr('is:done')).toEqual(task('done'))
  })

  test('大小・全角は吸収する (タグ名と同じ正規化)', () => {
    expect(parseSearchExpr('IS:TODO')).toEqual(task('todo'))
    expect(parseSearchExpr('ｉｓ：ｔｏｄｏ')).toEqual(task('todo'))
  })

  test('既存の演算子と組み合わせられる', () => {
    expect(parseSearchExpr('#英単語 is:todo')).toEqual(
      and(tag('英単語'), task('todo')),
    )
    expect(parseSearchExpr('!is:todo')).toEqual(not(task('todo')))
    expect(parseSearchExpr('is:todo OR is:done')).toEqual(
      or(task('todo'), task('done')),
    )
  })

  test('引用すればリテラルの全文検索になる', () => {
    expect(parseSearchExpr('"is:todo"')).toEqual(t('is:todo'))
  })

  test('知らない値はただの語に落とす (0 件にせず説明可能な結果を返す)', () => {
    expect(parseSearchExpr('is:foo')).toEqual(t('is:foo'))
    expect(parseSearchExpr('is:')).toEqual(t('is:'))
  })

  test('語の途中の is: は演算子にしない', () => {
    expect(parseSearchExpr('this:todo')).toEqual(t('this:todo'))
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

  // 足した式は items.ts の HAS_TASKS (task_todo > 0 OR task_done > 0) と
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
