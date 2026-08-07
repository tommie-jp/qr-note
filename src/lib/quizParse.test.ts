import { describe, expect, test } from 'vitest'
import { parseQuiz, type Quiz } from './quizParse'

// 正常に解けたことを前提に中身を見るためのヘルパ。
// エラーだったらその文言ごと落とす (どこで転んだか判るように)
function ok(source: string): Quiz {
  const result = parseQuiz(source)
  if ('error' in result) {
    throw new Error(`解析に失敗した: ${result.error}`)
  }
  return result
}

function errorOf(source: string): string {
  const result = parseQuiz(source)
  if (!('error' in result)) {
    throw new Error('エラーになるはずが解析できてしまった')
  }
  return result.error
}

const BASIC = [
  '問: スイッチを閉じた直後の電流は。',
  '1. 0 A',
  '2. 1 A',
  '3. 2 A',
  '4. 3 A',
  '5. 4 A',
  '正解: 2',
  '解説: 直後のコンデンサは短絡とみなせる。',
].join('\n')

describe('正常系', () => {
  test('問・選択肢・正解・解説を取り出す', () => {
    const quiz = ok(BASIC)
    expect(quiz.question).toBe('スイッチを閉じた直後の電流は。')
    expect(quiz.choices).toEqual(['0 A', '1 A', '2 A', '3 A', '4 A'])
    expect(quiz.answer).toBe(2)
    expect(quiz.explanation).toBe('直後のコンデンサは短絡とみなせる。')
  })

  test('解説は省略できる', () => {
    const quiz = ok('問: 1+1 は。\n1. 1\n2. 2\n正解: 2')
    expect(quiz.explanation).toBeNull()
  })

  test('問・解説は複数行を保つ', () => {
    const quiz = ok(
      [
        '問: 図の回路について答えよ。',
        'ただし $R=2\\,\\Omega$ とする。',
        '1. あ',
        '2. い',
        '正解: 1',
        '解説: まず時定数を求める。',
        '',
        'つぎに漸近値を求める。',
      ].join('\n'),
    )
    expect(quiz.question).toBe(
      '図の回路について答えよ。\nただし $R=2\\,\\Omega$ とする。',
    )
    expect(quiz.explanation).toBe(
      'まず時定数を求める。\n\nつぎに漸近値を求める。',
    )
  })

  test('選択肢も複数行を保つ', () => {
    const quiz = ok('問: あ\n1. 上\n下\n2. い\n正解: 1')
    expect(quiz.choices).toEqual(['上\n下', 'い'])
  })

  test('全角のコロンと句点、キーワード後の空白なしも読む', () => {
    const quiz = ok('問：あ\n1．い\n2．う\n正解：2')
    expect(quiz.question).toBe('あ')
    expect(quiz.choices).toEqual(['い', 'う'])
    expect(quiz.answer).toBe(2)
  })

  test('全角数字も読む (日本語入力では出やすい)', () => {
    const quiz = ok('問: あ\n１. い\n２. う\n正解: ２')
    expect(quiz.choices).toEqual(['い', 'う'])
    expect(quiz.answer).toBe(2)
  })

  test('正解の番号に括弧や「番」が付いていても読む', () => {
    expect(ok('問: あ\n1. い\n2. う\n正解: (2)').answer).toBe(2)
    expect(ok('問: あ\n1. い\n2. う\n正解: 2番').answer).toBe(2)
  })

  test('選択肢は 9 個まで書ける', () => {
    const nine = [
      '問: あ',
      ...Array.from({ length: 9 }, (_, i) => `${i + 1}. 選択肢${i + 1}`),
      '正解: 9',
    ].join('\n')
    expect(ok(nine).choices).toHaveLength(9)
  })

  test('問題文の中の番号付きリストは選択肢にしない', () => {
    // 1 から始まらないので選択肢の始まりと見ない
    const quiz = ok('問: つぎのうち正しいものは。\n2. これは本文\n1. あ\n2. い\n正解: 1')
    expect(quiz.question).toBe('つぎのうち正しいものは。\n2. これは本文')
    expect(quiz.choices).toEqual(['あ', 'い'])
  })

  test('選択肢の後ろの続き行は選択肢の一部にする', () => {
    // 番号付きに見えない行は、素直に直前の選択肢の続き
    const quiz = ok('問: あ\n1. い\nの場合\n2. う\n正解: 1')
    expect(quiz.choices).toEqual(['い\nの場合', 'う'])
  })

  test('前後の空行は落とす', () => {
    const quiz = ok('\n\n問: あ\n\n1. い\n2. う\n\n正解: 1\n\n')
    expect(quiz.question).toBe('あ')
    expect(quiz.choices).toEqual(['い', 'う'])
  })
})

describe('形式エラー', () => {
  test('問がない', () => {
    expect(errorOf('1. い\n2. う\n正解: 1')).toContain('問')
  })

  test('問より前に本文がある', () => {
    expect(errorOf('まえがき\n問: あ\n1. い\n2. う\n正解: 1')).toContain('問')
  })

  test('問の中身が空', () => {
    expect(errorOf('問:\n1. い\n2. う\n正解: 1')).toContain('空')
  })

  test('選択肢が 1 つしかない', () => {
    expect(errorOf('問: あ\n1. い\n正解: 1')).toContain('選択肢')
  })

  // 黙って直前の選択肢に吸い込むと、選択肢が 1 つ消えたまま「解ける問題」に
  // なってしまう (正解番号が生き残った範囲内なら誰も気付けない)
  test('選択肢の番号が飛んでいる', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n4. え\n正解: 1')).toContain('番号')
  })

  test('選択肢の番号が入れ替わっている', () => {
    expect(errorOf('問: あ\n1. い\n3. う\n2. え\n正解: 1')).toContain('番号')
  })

  test('選択肢が 10 個ある', () => {
    const ten = [
      '問: あ',
      ...Array.from({ length: 10 }, (_, i) => `${i + 1}. 選択肢${i + 1}`),
      '正解: 1',
    ].join('\n')
    expect(errorOf(ten)).toContain('9')
  })

  test('選択肢の中身が空', () => {
    expect(errorOf('問: あ\n1. い\n2.\n正解: 1')).toContain('選択肢')
  })

  test('正解がない', () => {
    expect(errorOf('問: あ\n1. い\n2. う')).toContain('正解')
  })

  test('正解が数字でない', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n正解: に')).toContain('正解')
  })

  // 先頭の数字だけ拾って残りを捨てると、書いた人の意図と違う問題が
  // 黙って出来上がる
  test('正解に複数の番号が書かれている', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n正解: 1と2')).toContain('1 つだけ')
  })

  test('正解が小数', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n正解: 1.5')).toContain('1 つだけ')
  })

  test('正解が選択肢の範囲外', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n正解: 5')).toContain('正解')
  })

  test('正解が 0', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n正解: 0')).toContain('正解')
  })

  test('問が 2 つある', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n正解: 1\n問: か')).toContain('問')
  })

  test('正解が 2 つある', () => {
    expect(errorOf('問: あ\n1. い\n2. う\n正解: 1\n正解: 2')).toContain('正解')
  })

  test('解説が 2 つある', () => {
    expect(
      errorOf('問: あ\n1. い\n2. う\n正解: 1\n解説: え\n解説: お'),
    ).toContain('解説')
  })

  test('正解の後ろに宙に浮いた行がある (解説の打ち間違い)', () => {
    // 「解説」を「解答」と打ち間違えた場合など。黙って捨てずに知らせる
    expect(errorOf('問: あ\n1. い\n2. う\n正解: 1\n解答: え')).toContain('解説')
  })

  test('解説が問より先にある', () => {
    // 「問が 2 つある」ではないので、そう言わない
    const error = errorOf('解説: え\n問: あ\n1. い\n2. う\n正解: 1')
    expect(error).toContain('いちばん先')
    expect(error).not.toContain('2 つ')
  })

  test('空のフェンス', () => {
    expect(errorOf('   \n\n')).toContain('問')
  })

  test('CRLF の本文も読む', () => {
    const quiz = parseQuiz('問: あ\r\n1. い\r\n2. う\r\n正解: 2')
    expect(quiz).toMatchObject({ answer: 2, choices: ['い', 'う'] })
  })
})
