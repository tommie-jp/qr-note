// 検索ヒットの行を進捗の表に畳む (DB 非依存の純関数。
// docs/77-進捗マトリックス計画.md §4)。
//
// **DB から集計せず、行を受け取って畳む。** 純関数なので DB 無しでテストでき、
// オフライン (端末の写しも tags / taskTodo / taskDone を持つ) でも同じ関数が
// 同じ表を作れる。特性表 (searchItemProps + buildPropsTable) と同じ役割分担。

import { memoSummary } from './memoSummary'
import { normalizeCheckLabel } from './matrixFence'
import { checkStates } from './taskCheckbox'

// 列を省いたときに出す 1 列の見出し
export const STATUS_COLUMN_LABEL = '状態'

// 名前付きの列のセル。
//   absent … そのノートにその名前の項目が無い。**未チェックと区別する**のが
//   要点で、丸めると「書き忘れ」が「まだやっていない」に紛れて埋もれる
export type CheckCell = 'checked' | 'unchecked' | 'absent'

// 状態 1 列のセル (docs/60-学習進捗計画.md §1 の 3 状態)
export type StatusCell = 'untouched' | 'learning' | 'mastered'

export type MatrixCell = CheckCell | StatusCell

// 表の元になる 1 行 (items.searchItemChecks が返す形)
export interface MatrixSourceRow {
  itemNo: string
  memo: string
  taskTodo: number
  taskDone: number
}

export interface MatrixTableRow {
  itemNo: string
  // 一覧と同じ 1 行目の要約。**memo はここで捨てる** — 表は client へ渡るので、
  // 本文全文を送らない (特性表と同じ約束)
  summary: string
  // columns と同じ長さ・同じ並び
  cells: MatrixCell[]
}

export interface MatrixTableData {
  kind: 'checks' | 'status'
  columns: string[]
  rows: MatrixTableRow[]
  // 表に載っている行数。列の数で二重に数えない
  total: number
  // 列ごとの「済み」件数 (状態 1 列のときは習得の件数)
  done: number[]
  // 上限を超えて表に載らなかった件数。黙って打ち切ると「これで全部」と読める
  omitted: number
}

function statusOf(row: MatrixSourceRow): StatusCell {
  if (row.taskDone === 0) {
    return 'untouched'
  }
  return row.taskTodo === 0 ? 'mastered' : 'learning'
}

// 本文 → 「チェックの名前 → 状態」。remark の全文解析が要るので、
// 1 回の描画で同じ本文を何度も解析しないよう外から控えを渡せるようにする
// (1 ノートに表が複数あるとき、対象のノートは大きく重なる)
function checkStateMap(
  memo: string,
  cache: Map<string, ReadonlyMap<string, boolean>>,
): ReadonlyMap<string, boolean> {
  const cached = cache.get(memo)
  if (cached !== undefined) {
    return cached
  }
  // 同じ名前が 2 つあれば最初の 1 つを使う (Map は後勝ちなので、
  // 既に入っている鍵は上書きしない)
  const states = new Map<string, boolean>()
  for (const state of checkStates(memo)) {
    const key = normalizeCheckLabel(state.label)
    if (!states.has(key)) {
      states.set(key, state.checked)
    }
  }
  cache.set(memo, states)
  return states
}

function checkCellsOf(
  row: MatrixSourceRow,
  keys: string[],
  cache: Map<string, ReadonlyMap<string, boolean>>,
): CheckCell[] {
  const states = checkStateMap(row.memo, cache)
  return keys.map((key) => {
    const checked = states.get(key)
    if (checked === undefined) {
      return 'absent'
    }
    return checked ? 'checked' : 'unchecked'
  })
}

// columns が空なら状態 1 列、そうでなければ名前付きの列で表を組む。
//
// 状態 1 列は task_todo / task_done だけで決まるので**本文を解析しない** —
// 名前の付いた列が要るときだけ解析する費用の階段になっている (計画 §3)。
export function buildMatrixTable(
  sourceRows: readonly MatrixSourceRow[],
  columns: readonly string[],
  omitted: number,
  // 本文の解析結果の控え。同じ描画で表を複数作るときに呼び出し側が持ち回る
  // (省略すればこの表の中だけで効く)
  parseCache: Map<string, ReadonlyMap<string, boolean>> = new Map(),
): MatrixTableData {
  const isStatus = columns.length === 0
  const keys = columns.map(normalizeCheckLabel)

  const rows: MatrixTableRow[] = sourceRows.map((row) => ({
    itemNo: row.itemNo,
    summary: memoSummary(row.memo),
    cells: isStatus ? [statusOf(row)] : checkCellsOf(row, keys, parseCache),
  }))

  const width = isStatus ? 1 : columns.length
  const done = Array.from({ length: width }, (_, index) =>
    rows.filter(
      (row) => row.cells[index] === (isStatus ? 'mastered' : 'checked'),
    ).length,
  )

  return {
    kind: isStatus ? 'status' : 'checks',
    columns: isStatus ? [STATUS_COLUMN_LABEL] : [...columns],
    rows,
    total: rows.length,
    done,
    omitted,
  }
}
