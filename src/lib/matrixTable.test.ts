import { describe, expect, test } from 'vitest'
import { buildMatrixTable, STATUS_COLUMN_LABEL, type MatrixSourceRow } from './matrixTable'

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

describe('buildMatrixTable (列を省いたとき)', () => {
  const rows = [
    row('4551', '問1', 0, 2), // 全部チェック = 習得
    row('4552', '問2', 1, 1), // 一部チェック = 学習中
    row('4553', '問3', 2, 0), // 未チェック = 未着手
  ]

  test('状態 1 列になる', () => {
    const table = buildMatrixTable(rows, [], 0)
    expect(table.kind).toBe('status')
    expect(table.columns).toEqual([STATUS_COLUMN_LABEL])
  })

  test('3 状態を出し分ける', () => {
    const table = buildMatrixTable(rows, [], 0)
    expect(table.rows.map((r) => r.cells[0])).toEqual([
      'mastered',
      'learning',
      'untouched',
    ])
  })

  test('済み数は習得の件数', () => {
    expect(buildMatrixTable(rows, [], 0).done).toEqual([1])
  })

  test('本文を読まないので memo が空でも数えられる', () => {
    const table = buildMatrixTable([row('4560', '', 0, 1)], [], 0)
    expect(table.rows[0].cells).toEqual(['mastered'])
  })
})

describe('buildMatrixTable (空)', () => {
  test('行が無ければ空の表', () => {
    const table = buildMatrixTable([], ['学習済み'], 0)
    expect(table.rows).toEqual([])
    expect(table.total).toBe(0)
    expect(table.done).toEqual([0])
  })
})
