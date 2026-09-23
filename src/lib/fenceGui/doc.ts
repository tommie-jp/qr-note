import type { Change, DocLike } from 'fence-kit/shell'

// 殻 (fence-kit の session) に渡す「文書」(docs/99-フェンスGUI編集計画.md)。
// 上流 playground の src/map/doc.ts の写し — 殻は Markdown の**全文**を相手にし、
// フェンスの開きの行から本文の行を数える (52 の docs/43)。
//
// 写す理由: fence-kit/shell が出すのは殻と型だけで、宿主の側の文書は宿主が持つ
// (VS Code なら TextDocument)。3 つの関数はどれも 20 行ほどの純関数

// 文書はノートの本文 1 つだけ。殻は URI で文書を引き直す
export const DOC_URI = 'qr-note:memo'

// いまの全文を見せ続ける文書。**中身を持たない** — 呼ばれるたびに text() から
// 組み直す。持つと、書き換えたあとに古い姿を配り続ける (殻は文書を覚えていて、
// あとから何度でも読み直す)
export function docOver(text: () => string): DocLike {
  const lines = (): string[] => text().split('\n')
  return {
    uri: { toString: () => DOC_URI },
    getText: () => text(),
    get lineCount(): number {
      return lines().length
    },
    lineAt: (line: number) => {
      const found = lines()[line]
      // vscode も範囲の外は投げる。黙って空行を返すと、ずれたまま書き換える
      if (found === undefined) {
        throw new Error(`${line} 行目はありません`)
      }
      return { text: found }
    },
  }
}

// 書き換えを当てる。**当てる前に、そこにある字が控えと合うか確かめる**
// (合わなければ null。拡張の applyChanges と同じ約束)。
//
// 同じ行に 2 か所あるときは**右から**当てる。控えの桁は当てる前のものなので、
// 左から当てると、先に伸びた分だけ右の桁がずれる
export function applyChanges(
  lines: readonly string[],
  changes: readonly Change[],
): string[] | null {
  const ordered = [...changes].sort(
    (a, b) => b.line - a.line || b.from.column - a.from.column,
  )
  let out: readonly string[] = lines
  for (const change of ordered) {
    const line = out[change.line]
    if (line === undefined) {
      return null
    }
    const { column, text } = change.from
    if (line.slice(column, column + text.length) !== text) {
      return null
    }
    const replaced = line.slice(0, column) + change.to.text + line.slice(column + text.length)
    out = out.map((one, index) => (index === change.line ? replaced : one))
  }
  return [...out]
}

// 本文を丸ごと書き戻す (戻す・やり直す・行の出し入れ)。範囲の外は断る。
// **0 行は断らない** — 本文が空のフェンスは入れ替える行が無いだけで、
// 書き足せないわけではない (52 の docs/54)
export function replaceLines(
  lines: readonly string[],
  from: number,
  count: number,
  body: readonly string[],
): string[] | null {
  if (count < 0 || from < 0 || from > lines.length || from + count > lines.length) {
    return null
  }
  return [...lines.slice(0, from), ...body, ...lines.slice(from + count)]
}
