import { describe, expect, test } from 'vitest'
import { MAX_MATRIX_COLUMNS } from './matrixFence'
import {
  buildMatrixTable,
  commonTitlePrefix,
  donePercent,
  matrixCountLabel,
  STATUS_COLUMN_LABEL,
  type MatrixSourceRow,
} from './matrixTable'

function row(
  itemNo: string,
  memo: string,
  todo: number,
  done: number,
): MatrixSourceRow {
  return { itemNo, memo, taskTodo: todo, taskDone: done }
}

// 問題ノートの形 (docs-ignore の原稿と同じ 2 チェック)
function quizNote(title: string, learned: boolean, confident: boolean): string {
  return [
    title,
    '',
    `- [${learned ? 'x' : ' '}] 学習済み`,
    `- [${confident ? 'x' : ' '}] 自信あり`,
  ].join('\n')
}

describe('buildMatrixTable (名前付きの列)', () => {
  const rows = [
    row('4551', quizNote('問1', true, true), 0, 2),
    row('4552', quizNote('問2', true, false), 1, 1),
    row('4553', quizNote('問3', false, false), 2, 0),
  ]
  const columns = ['学習済み', '自信あり']

  test('列は書かれたままの名前で出る', () => {
    const table = buildMatrixTable(rows, columns, 0)
    expect(table.kind).toBe('checks')
    expect(table.columns).toEqual(['学習済み', '自信あり'])
  })

  test('行は渡された順のまま (並べ替えは SQL の仕事)', () => {
    const table = buildMatrixTable(rows, columns, 0)
    expect(table.rows.map((r) => r.itemNo)).toEqual(['4551', '4552', '4553'])
  })

  test('セルはチェックの状態になる', () => {
    const table = buildMatrixTable(rows, columns, 0)
    expect(table.rows[0].cells).toEqual(['checked', 'checked'])
    expect(table.rows[1].cells).toEqual(['checked', 'unchecked'])
    expect(table.rows[2].cells).toEqual(['unchecked', 'unchecked'])
  })

  // ここを unchecked に丸めると、書き忘れが「まだやっていない」に紛れて
  // 永久に埋もれる (計画 §4)
  test('その名前の項目が無い行は absent (未チェックと区別する)', () => {
    const table = buildMatrixTable(
      [row('4554', '問4\n\n- [x] 学習済み', 0, 1)],
      columns,
      0,
    )
    expect(table.rows[0].cells).toEqual(['checked', 'absent'])
  })

  test('名前の照合は全角・大文字小文字・空白を畳む', () => {
    const table = buildMatrixTable(
      [row('4555', '問5\n\n- [x] ＴＯＤＯ', 0, 1)],
      ['todo'],
      0,
    )
    expect(table.rows[0].cells).toEqual(['checked'])
  })

  test('前方一致では当てない', () => {
    const table = buildMatrixTable(
      [row('4556', '問6\n\n- [x] 学習済みだが自信なし', 0, 1)],
      ['学習済み'],
      0,
    )
    expect(table.rows[0].cells).toEqual(['absent'])
  })

  test('行の見出しは 1 行目の要約', () => {
    const table = buildMatrixTable(rows, columns, 0)
    expect(table.rows[0].summary).toBe('問1')
  })

  test('列ごとの済み数を数える', () => {
    const table = buildMatrixTable(rows, columns, 0)
    expect(table.done).toEqual([2, 1])
  })

  test('総数は行数 (列の数で二重に数えない)', () => {
    expect(buildMatrixTable(rows, columns, 0).total).toBe(3)
  })

  test('溢れた件数はそのまま持ち回る', () => {
    expect(buildMatrixTable(rows, columns, 7).omitted).toBe(7)
  })

  test('同じ名前が 2 つある本文では最初の 1 つを使う', () => {
    const table = buildMatrixTable(
      [row('4557', '問7\n\n- [x] 学習済み\n- [ ] 学習済み', 1, 1)],
      ['学習済み'],
      0,
    )
    expect(table.rows[0].cells).toEqual(['checked'])
  })
})

describe('buildMatrixTable (列を省いたとき = 本文から拾う)', () => {
  const rows = [
    row('4551', quizNote('問1', true, true), 0, 2),
    row('4552', quizNote('問2', true, false), 1, 1),
    row('4553', quizNote('問3', false, false), 2, 0),
  ]

  test('検索結果に出てきたチェックがそのまま列になる', () => {
    const table = buildMatrixTable(rows, [], 0)
    expect(table.kind).toBe('checks')
    expect(table.columns).toEqual(['学習済み', '自信あり'])
    expect(table.rows[1].cells).toEqual(['checked', 'unchecked'])
  })

  test('列の並びは出現数の多い順 (同数は先に出てきた順)', () => {
    const stray = row('4554', '問4\n\n- [ ] 学習済み\n- [x] 要復習', 1, 1)
    const table = buildMatrixTable([...rows, stray], [], 0)
    // 学習済み 4 件 / 自信あり 3 件 / 要復習 1 件
    expect(table.columns).toEqual(['学習済み', '自信あり', '要復習'])
  })

  test('照合すると同じ名前は 1 列にまとめる (表記は初出のまま)', () => {
    const table = buildMatrixTable(
      [
        row('4555', '問5\n\n- [x] ＴＯＤＯ', 0, 1),
        row('4556', '問6\n\n- [ ] todo', 1, 0),
      ],
      [],
      0,
    )
    expect(table.columns).toEqual(['ＴＯＤＯ'])
    expect(table.rows.map((r) => r.cells[0])).toEqual(['checked', 'unchecked'])
  })

  test(`列は ${MAX_MATRIX_COLUMNS} つまでで、溢れた数を返す`, () => {
    const many = Array.from(
      { length: MAX_MATRIX_COLUMNS + 2 },
      (_, i) => `- [ ] 印${i}`,
    ).join('\n')
    const table = buildMatrixTable([row('4557', `問7\n\n${many}`, 6, 0)], [], 0)
    expect(table.columns).toHaveLength(MAX_MATRIX_COLUMNS)
    expect(table.columnsOmitted).toBe(2)
  })

  test('列を明示したときは溢れを数えない', () => {
    expect(buildMatrixTable(rows, ['学習済み'], 0).columnsOmitted).toBe(0)
  })

  // 名前の無いチェック (`- [ ]` だけ) では列が作れないので、3 状態に落とす
  test('名前のあるチェックが無ければ状態 1 列に落ちる', () => {
    const table = buildMatrixTable([row('4560', '問8\n\n- [x]', 0, 1)], [], 0)
    expect(table.kind).toBe('status')
    expect(table.columns).toEqual([STATUS_COLUMN_LABEL])
    expect(table.rows[0].cells).toEqual(['mastered'])
  })

  test('状態 1 列のときは 3 状態を出し分ける', () => {
    const plain = [
      row('4561', '問1\n\n- [x]', 0, 2),
      row('4562', '問2\n\n- [x]', 1, 1),
      row('4563', '問3\n\n- [ ]', 2, 0),
    ]
    const table = buildMatrixTable(plain, [], 0)
    expect(table.rows.map((r) => r.cells[0])).toEqual([
      'mastered',
      'learning',
      'untouched',
    ])
    expect(table.done).toEqual([1])
  })
})

describe('buildMatrixTable (空)', () => {
  test('行が無ければ空の表', () => {
    const table = buildMatrixTable([], ['学習済み'], 0)
    expect(table.rows).toEqual([])
    expect(table.total).toBe(0)
    expect(table.done).toEqual([0])
  })

  test('行が無く列も省いたときは状態 1 列 (拾う先が無い)', () => {
    const table = buildMatrixTable([], [], 0)
    expect(table.kind).toBe('status')
    expect(table.rows).toEqual([])
  })
})

// 「項目なし」を未チェックと区別するのが設計の要点 (計画 §4) なのに、率の
// 分母を全行にすると混ぜたのと同じ数字になる。100 件の検索結果のうち
// 10 件しか `学習済み` を持たず、その 10 件すべてに付けても「10.0% (10)」と
// 出て、書き忘れの 90 件が未了として率を薄める
describe('buildMatrixTable (列ごとの率の母数)', () => {
  test('項目なしの行は母数から外す', () => {
    const rows = [
      row('4551', '問1\n\n- [x] 学習済み', 0, 1),
      row('4552', '買い物\n\n- [x] 牛乳', 0, 1),
      row('4553', '買い物\n\n- [ ] 牛乳', 1, 0),
    ]
    const table = buildMatrixTable(rows, ['学習済み'], 0)
    expect(table.rows.map((r) => r.cells[0])).toEqual([
      'checked',
      'absent',
      'absent',
    ])
    expect(table.done).toEqual([1])
    expect(table.columnTotals).toEqual([1])
    expect(donePercent(table.done[0], table.columnTotals[0])).toBe('100.0')
  })

  test('未チェックの行は母数に入る (項目なしと区別する)', () => {
    const rows = [
      row('4551', quizNote('問1', true, true), 0, 2),
      row('4552', quizNote('問2', true, false), 1, 1),
      row('4553', '問3\n\n- [ ] 学習済み', 1, 0),
    ]
    const table = buildMatrixTable(rows, ['学習済み', '自信あり'], 0)
    // 学習済み … 3 行すべてが持つ / 自信あり … 問3 だけ持たない
    expect(table.columnTotals).toEqual([3, 2])
    expect(table.done).toEqual([2, 1])
  })

  test('状態 1 列の母数は全行 (「項目なし」という状態が無い)', () => {
    const table = buildMatrixTable(
      [row('4561', '問1\n\n- [x]', 0, 1), row('4562', '問2\n\n- [ ]', 1, 0)],
      [],
      0,
    )
    expect(table.kind).toBe('status')
    expect(table.columnTotals).toEqual([2])
  })

  test('全行が項目なしなら母数 0 (0/0 を出さない)', () => {
    const table = buildMatrixTable(
      [row('4552', '買い物\n\n- [x] 牛乳', 0, 1)],
      ['学習済み'],
      0,
    )
    expect(table.columnTotals).toEqual([0])
    expect(donePercent(table.done[0], table.columnTotals[0])).toBe('0.0')
  })
})

// 上限 (200 行) で切った表の率は**載っている行だけ**の率。件数を「全 200 件」と
// 名乗ると、500 件当たっているうちの 200 件が済みなだけで「全 200 件 100.0%」に
// 見え、残り 300 件があるのに終わったと読める
describe('matrixCountLabel', () => {
  const rows = [
    row('4551', quizNote('問1', true, true), 0, 2),
    row('4552', quizNote('問2', true, false), 1, 1),
    row('4553', quizNote('問3', false, false), 2, 0),
  ]

  test('打ち切っていなければ「全 N 件」', () => {
    expect(matrixCountLabel(buildMatrixTable(rows, ['学習済み'], 0))).toBe(
      '全 3 件',
    )
  })

  test('打ち切ったら何件のうち何件かを言う (率の母数を名乗る)', () => {
    expect(matrixCountLabel(buildMatrixTable(rows, ['学習済み'], 7))).toBe(
      '全 10 件中 3 件',
    )
  })

  test('0 件でも「全 0 件」', () => {
    expect(matrixCountLabel(buildMatrixTable([], ['学習済み'], 0))).toBe(
      '全 0 件',
    )
  })
})

describe('donePercent', () => {
  test('小数点 1 桁まで出す', () => {
    expect(donePercent(7, 9)).toBe('77.7')
    expect(donePercent(5, 9)).toBe('55.5')
  })

  // 切り上げると 999/1000 が「100.0%」になり、終わっていないのに終わって
  // 見える。率は床関数、という既存の作法 (docs/60 §2) に揃える
  test('切り上げない (床関数)', () => {
    expect(donePercent(1, 3)).toBe('33.3')
    expect(donePercent(2, 3)).toBe('66.6')
    expect(donePercent(1999, 2000)).toBe('99.9')
  })

  test('端は 0.0 と 100.0', () => {
    expect(donePercent(0, 9)).toBe('0.0')
    expect(donePercent(9, 9)).toBe('100.0')
  })

  test('分母 0 は 0.0 (0/0 を出さない)', () => {
    expect(donePercent(0, 0)).toBe('0.0')
  })
})

// 表の中では「01電験三種 01理論 01直流回路」は全行に等しく付いた飾りで、
// 1 行の情報量に寄与しない。狭い画面ではそれがいちばん見たい「問01」以降を
// 押し出す (docs/84-表タイトル短縮計画.md)
describe('commonTitlePrefix', () => {
  test('共通する先頭の語を返す', () => {
    // Arrange
    const summaries = [
      '01電験三種 01理論 01直流回路 問01 (直列と並列の合成抵抗)',
      '01電験三種 01理論 01直流回路 問02 (分圧則・直列抵抗の電圧配分)',
    ]

    // Act
    const prefix = commonTitlePrefix(summaries)

    // Assert
    expect(prefix).toBe('01電験三種 01理論 01直流回路 ')
    expect(summaries[0].slice(prefix.length)).toBe('問01 (直列と並列の合成抵抗)')
  })

  // 文字単位のまま削ると、問 01〜問 09 だけの表で共通部分が「問0」まで伸び、
  // 行が「1 (直列と並列の合成抵抗)」になる
  test('語の途中では切らない', () => {
    expect(commonTitlePrefix(['問01 直列', '問02 分圧'])).toBe('')
  })

  test('共通する語が無ければ削らない', () => {
    expect(commonTitlePrefix(['過渡現象 問1', '静電気 問1'])).toBe('')
  })

  // 1 行しかない表は共通部分 = その名前そのもの。削ると全部消える
  test('行が 1 つなら削らない', () => {
    expect(commonTitlePrefix(['01電験三種 01理論 問01 (合成抵抗)'])).toBe('')
    expect(commonTitlePrefix([])).toBe('')
  })

  test('全角空白も区切りとして扱う', () => {
    expect(commonTitlePrefix(['電験三種　問01', '電験三種　問02'])).toBe(
      '電験三種　',
    )
  })

  // 全行が同じ名前でも最後の語は残す (残りが空の行を作らない)
  test('名前がまったく同じでも最後の語は残る', () => {
    expect(commonTitlePrefix(['過渡現象 問1', '過渡現象 問1'])).toBe('過渡現象 ')
    expect(commonTitlePrefix(['問1', '問1'])).toBe('')
  })

  // 短い行が長い行の先頭そのものだと、残りが空になる行が出る
  test('残りが空になる行があれば削らない', () => {
    expect(commonTitlePrefix(['過渡現象 問1', '過渡現象 問1 補足'])).toBe(
      '過渡現象 ',
    )
    expect(commonTitlePrefix(['過渡現象', '過渡現象 問1'])).toBe('')
    // 名前の末尾に空白がある形でも、空の行は作らない
    expect(commonTitlePrefix(['過渡現象 ', '過渡現象 問1'])).toBe('')
  })
})
