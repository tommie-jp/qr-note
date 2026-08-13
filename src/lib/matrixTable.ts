// 検索ヒットの行を進捗の表に畳む (DB 非依存の純関数。
// docs/77-進捗マトリックス計画.md §4)。
//
// **DB から集計せず、行を受け取って畳む。** 純関数なので DB 無しでテストでき、
// オフライン (端末の写しも tags / taskTodo / taskDone を持つ) でも同じ関数が
// 同じ表を作れる。特性表 (searchItemProps + buildPropsTable) と同じ役割分担。

import { memoSummary } from './memoSummary'
import { MAX_MATRIX_COLUMNS, normalizeCheckLabel } from './matrixFence'
import { checkStates, type CheckState } from './taskCheckbox'

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
  // col= を省いて本文から拾ったとき、上限を超えて載せなかった列の数。
  // 明示したときは 0 (上限超えはフェンスの解析でエラーになる)
  columnsOmitted: number
}

// 済みの率を「小数点 1 桁」の文字列にする。
//
// **切り上げない (床関数)。** 四捨五入すると 1999/2000 が「100.0%」になり、
// 1 件残っているのに終わったように見える — 率は床関数、という既存の作法
// (docs/60-学習進捗計画.md §2 の TaskProgress) に揃える。
// 100.0 になるのは本当に全部済んだときだけ。
export function donePercent(done: number, total: number): string {
  if (total <= 0) {
    return '0.0'
  }
  return (Math.floor((done / total) * 1000) / 10).toFixed(1)
}

function statusOf(row: MatrixSourceRow): StatusCell {
  if (row.taskDone === 0) {
    return 'untouched'
  }
  return row.taskTodo === 0 ? 'mastered' : 'learning'
}

// 本文の解析結果の控え。remark の全文解析が要るので、1 回の描画で同じ本文を
// 何度も解析しないよう外から渡せるようにする (1 ノートに表が複数あるとき、
// 対象のノートは大きく重なる)。**名前の並びも要る**ので配列で持つ —
// 列を本文から拾うときに初出順が必要になる
export type CheckParseCache = Map<string, readonly CheckState[]>

function statesOf(memo: string, cache: CheckParseCache): readonly CheckState[] {
  const cached = cache.get(memo)
  if (cached !== undefined) {
    return cached
  }
  const states = checkStates(memo)
  cache.set(memo, states)
  return states
}

function checkCellsOf(
  row: MatrixSourceRow,
  keys: string[],
  cache: CheckParseCache,
): CheckCell[] {
  // 同じ名前が 2 つあれば最初の 1 つを使う (既に入っている鍵は上書きしない)
  const states = new Map<string, boolean>()
  for (const state of statesOf(row.memo, cache)) {
    const key = normalizeCheckLabel(state.label)
    if (!states.has(key)) {
      states.set(key, state.checked)
    }
  }
  return keys.map((key) => {
    const checked = states.get(key)
    if (checked === undefined) {
      return 'absent'
    }
    return checked ? 'checked' : 'unchecked'
  })
}

// col= を省いたときの列。**検索結果のノートに実際に出てきたチェックの名前**を
// 集める (計画 §3)。`col=学習済み,自信あり` と書かなくても
// ` ```matrix ` + 検索式だけで表になるように。
//
// 並びは**出現数の多い順**、同数なら初出順。上限で切るとき、混ざった 1 件だけの
// 名前 (別の用途のノートのチェック) から先に落ちるようにするため。
function deriveColumns(
  sourceRows: readonly MatrixSourceRow[],
  cache: CheckParseCache,
): { columns: string[]; omitted: number } {
  // 鍵 = 照合用に畳んだ名前、値 = 表示に使う初出の綴り + 出現数 + 初出の順番
  const found = new Map<string, { label: string; count: number; first: number }>()
  let order = 0
  for (const row of sourceRows) {
    // 1 つのノートの中で同じ名前が 2 度出ても 1 件と数える
    const seenInRow = new Set<string>()
    for (const state of statesOf(row.memo, cache)) {
      const key = normalizeCheckLabel(state.label)
      // 名前の無いチェック (`- [x]` だけ) は列にできない
      if (key === '' || seenInRow.has(key)) {
        continue
      }
      seenInRow.add(key)
      const hit = found.get(key)
      if (hit === undefined) {
        found.set(key, { label: state.label, count: 1, first: order++ })
      } else {
        hit.count++
      }
    }
  }

  const sorted = [...found.values()].sort(
    (a, b) => b.count - a.count || a.first - b.first,
  )
  return {
    columns: sorted.slice(0, MAX_MATRIX_COLUMNS).map((entry) => entry.label),
    omitted: Math.max(0, sorted.length - MAX_MATRIX_COLUMNS),
  }
}

// 表を組む。
//
// columns を渡さなければ**検索結果のノートに出てきたチェックから列を作る**
// (計画 §3)。名前の付いたチェックが 1 つも無いときだけ、3 状態の 1 列に落ちる
// — `- [x]` のように名前を書いていない本文では列が作れないため。
export function buildMatrixTable(
  sourceRows: readonly MatrixSourceRow[],
  columns: readonly string[],
  omitted: number,
  // 本文の解析結果の控え。同じ描画で表を複数作るときに呼び出し側が持ち回る
  // (省略すればこの表の中だけで効く)
  parseCache: CheckParseCache = new Map(),
): MatrixTableData {
  const derived =
    columns.length === 0 ? deriveColumns(sourceRows, parseCache) : null
  const shown = derived === null ? [...columns] : derived.columns
  const isStatus = shown.length === 0
  const keys = shown.map(normalizeCheckLabel)

  const rows: MatrixTableRow[] = sourceRows.map((row) => ({
    itemNo: row.itemNo,
    summary: memoSummary(row.memo),
    cells: isStatus ? [statusOf(row)] : checkCellsOf(row, keys, parseCache),
  }))

  const width = isStatus ? 1 : shown.length
  const done = Array.from({ length: width }, (_, index) =>
    rows.filter(
      (row) => row.cells[index] === (isStatus ? 'mastered' : 'checked'),
    ).length,
  )

  return {
    kind: isStatus ? 'status' : 'checks',
    columns: isStatus ? [STATUS_COLUMN_LABEL] : shown,
    rows,
    total: rows.length,
    done,
    omitted,
    columnsOmitted: derived?.omitted ?? 0,
  }
}
