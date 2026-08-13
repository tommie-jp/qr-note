import { describe, expect, test } from 'vitest'
import { MAX_MATRIX_COLUMNS } from './matrixFence'
import {
  buildMatrixTable,
  donePercent,
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
