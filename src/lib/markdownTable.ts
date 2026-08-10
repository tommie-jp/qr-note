// GFM のテーブル記法を読んで、行・列・寄せに分解する
// (docs/70-編集ライブプレビュー計画.md §7)。
//
// 編集画面のライブプレビューが、カーソルの無いテーブルを表として描くために使う。
// **読むだけで、書き戻しはしない** — 表の見た目を出すのは表示層の仕事で、
// 本文は生の markdown のまま触らない。
//
// @atomic-editor/editor の tables (contenteditable のセルから本文へ書き戻す)
// を使わないのはこのため。あちらは書き戻しのたびに
//   - 寄せ (`:---:` / `---:`) を無条件に `---` へ潰し (見た目が変わる)、
//   - テーブル全体を整形しなおす (1 セル直しただけで全行が差分に出る)
// ので、ノートの git 履歴 (docs/57) を汚すうえに中身まで変わってしまう。
//
// ここは DOM も CodeMirror も触らない純関数なので node の vitest で検証できる。

export type CellAlign = 'left' | 'center' | 'right' | null

export interface MarkdownTable {
  header: string[]
  aligns: CellAlign[]
  rows: string[][]
}

// 区切り行 (`| --- | :-: |`)。ここが本物かどうかで「表かどうか」が決まる
const DELIMITER_CELL_RE = /^:?-+:?$/

// 行をセルに割る。**`\|` はセルの区切りにしない** (GFM の決まり) —
// 表の中にパイプ文字そのものを書くための唯一の手段なので、ここを取り違えると
// 「| を含む行」が列数の合わない表として崩れる。
export function splitTableRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') {
      // 逃がされたパイプ。セルの中身としては `|` 1 文字に戻す
      current += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  // 行頭・行末のパイプは飾り (GFM では省略できる)。割った結果の空の両端を落とす
  if (cells.length > 0 && cells[0].trim() === '') {
    cells.shift()
  }
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') {
    cells.pop()
  }
  return cells.map((cell) => cell.trim())
}

function alignOf(cell: string): CellAlign {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) {
    return 'center'
  }
  if (right) {
    return 'right'
  }
  if (left) {
    return 'left'
  }
  return null
}

// テーブル 1 つぶんの原文を読む。表として成り立たなければ null
// (呼ぶ側は生の markdown をそのまま見せる — 中途半端に描くより直しやすい)。
export function parseMarkdownTable(source: string): MarkdownTable | null {
  const lines = source.split('\n').filter((line) => line.trim() !== '')
  if (lines.length < 2) {
    return null
  }
  const header = splitTableRow(lines[0])
  const delimiter = splitTableRow(lines[1])
  if (header.length === 0 || delimiter.length !== header.length) {
    return null
  }
  if (!delimiter.every((cell) => DELIMITER_CELL_RE.test(cell))) {
    return null
  }
  // 列数は見出しに合わせて揃える。足りないセルは空、多い分は捨てる
  // (GFM の決まり。描くときに列がずれないようにここで正す)
  const rows = lines.slice(2).map((line) => {
    const cells = splitTableRow(line)
    return header.map((_, index) => cells[index] ?? '')
  })
  return { header, aligns: delimiter.map(alignOf), rows }
}
