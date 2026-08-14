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

describe('parseMatrixFence (mark=)', () => {
  test('省略すると既定 (null)', () => {
    expect(spec('#電験三種').marks).toBeNull()
  })

  test('未・済 の 2 つを読む', () => {
    expect(spec('#電験三種\nmark=☐✓').marks).toEqual({
      unchecked: '☐',
      checked: '✓',
      absent: null,
    })
  })

  // `✅️` は ✅ + 異体字セレクタの 2 コードポイント。コードポイントで割ると
  // 3 つ目に見えない文字が現れる
  test('絵文字は書記素で数える (異体字セレクタを落とさない)', () => {
    expect(spec('#電験三種\nmark=🟥✅️').marks).toEqual({
      unchecked: '🟥',
      checked: '✅️',
      absent: null,
    })
  })

  test('3 つ目は「項目なし」になる', () => {
    expect(spec('#電験三種\nmark=🟥✅️➖').marks).toEqual({
      unchecked: '🟥',
      checked: '✅️',
      absent: '➖',
    })
  })

  test('漢字も使える', () => {
    expect(spec('#電験三種\nmark=未済').marks).toMatchObject({
      unchecked: '未',
      checked: '済',
    })
  })

  test('1 つ・4 つはエラー', () => {
    expect(error('#電験三種\nmark=✓')).toContain('2 つ')
    expect(error('#電験三種\nmark=☐✓➖✔')).toContain('4 つ')
  })

  test('空はエラー', () => {
    expect(error('#電験三種\nmark=')).toContain('2 つ')
  })

  test('2 回書いたらエラー', () => {
    expect(error('#電験三種\nmark=☐✓\nmark=未済')).toContain('mark')
  })

  // NFKC は囲み文字を素の漢字に潰す (🈚 → 無)。値は打ったまま持つ
  test('値を NFKC で潰さない', () => {
    expect(spec('#電験三種\nmark=🈚🈶').marks).toEqual({
      unchecked: '🈚',
      checked: '🈶',
      absent: null,
    })
  })

  test('display= と書いたら mark= を教える', () => {
    expect(error('#電験三種\ndisplay=🟥✅️')).toContain('mark')
  })
})

// 記号をくっつけて書くのは打ちにくいので、間に空白やカンマを入れて書く。
// **区切りを記号として数えると気づけない壊れ方をする** — `mark=☐ ✓` が
// 「未=☐ / 済=空白 / 項目なし=✓」に割り当てられ、済みのセルが透明になり、
// 項目の無いノートが ✓ で「済み」に見える (エラーも出ない)
describe('parseMatrixFence (mark= の区切り)', () => {
  test('記号の間の空白は区切りとして読む', () => {
    expect(spec('#電験三種\nmark=☐ ✓').marks).toEqual({
      unchecked: '☐',
      checked: '✓',
      absent: null,
    })
  })

  test('全角の空白も区切り (日本語キーボードの既定)', () => {
    expect(spec('#電験三種\nmark=☐　✓').marks).toMatchObject({
      unchecked: '☐',
      checked: '✓',
    })
  })

  test('カンマ区切りでも書ける (col= と同じ見た目)', () => {
    expect(spec('#電験三種\nmark=☐,✓,—').marks).toEqual({
      unchecked: '☐',
      checked: '✓',
      absent: '—',
    })
  })

  test('全角カンマも区切り', () => {
    expect(spec('#電験三種\nmark=☐，✓').marks).toMatchObject({
      unchecked: '☐',
      checked: '✓',
    })
  })

  // 区切りを落とすのは記号の間だけ。異体字セレクタ (U+FE0F) は記号の一部
  test('区切りで並べても絵文字の異体字セレクタは落とさない', () => {
    expect(spec('#電験三種\nmark=🟥 ✅️ ➖').marks).toEqual({
      unchecked: '🟥',
      checked: '✅️',
      absent: '➖',
    })
  })

  test('個数は区切りを除いて数える', () => {
    expect(error('#電験三種\nmark=☐ ✓ ➖ ✔')).toContain('4 つ')
    expect(error('#電験三種\nmark=, ,')).toContain('2 つ')
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

// 名前の照合は NFKC で畳む (normalizeCheckLabel) のに区切りが半角カンマだけ
// だと、日本語キーボードの既定である全角カンマが区切りにならない。
// `col=学習済み，自信あり` が 1 列の長い名前になり、どのチェックにも当たらず
// 全セルが「項目なし」(0.0%) になる — しかもエラーは出ない
describe('parseMatrixFence (col= の区切り)', () => {
  test('全角カンマも区切りとして読む', () => {
    expect(spec('#電験三種\ncol=学習済み，自信あり').columns).toEqual([
      '学習済み',
      '自信あり',
    ])
  })

  test('半角と全角が混ざっていても読める', () => {
    expect(spec('#電験三種\ncol=学習済み，自信あり,要復習').columns).toEqual([
      '学習済み',
      '自信あり',
      '要復習',
    ])
  })

  // 区切りの判定は「NFKC で半角カンマに畳まれるか」なので、小字形 (U+FE50) の
  // ような珍しい打ち方も同じ扱いになる
  test('NFKC で半角カンマになる文字はどれも区切り', () => {
    expect(spec('#電験三種\ncol=学習済み﹐自信あり').columns).toEqual([
      '学習済み',
      '自信あり',
    ])
  })

  // 畳むのは区切りの判定だけ。名前は打ったまま持つ (表示に使う綴り)
  test('列の名前は畳まない', () => {
    expect(spec('#電験三種\ncol=ＴＯＤＯ，自信あり').columns).toEqual([
      'ＴＯＤＯ',
      '自信あり',
    ])
  })

  test('全角カンマ区切りでも重複と上限を見る', () => {
    expect(error('#電験三種\ncol=TODO，todo')).toContain('todo')
    const many = Array.from(
      { length: MAX_MATRIX_COLUMNS + 1 },
      (_, i) => `列${i}`,
    ).join('，')
    expect(error(`#電験三種\ncol=${many}`)).toContain(String(MAX_MATRIX_COLUMNS))
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
