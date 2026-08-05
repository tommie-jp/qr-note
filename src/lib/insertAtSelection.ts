// textarea の選択範囲へ文字を差し込む純関数
// (docs/53-シークレット挿入拡張計画.md §4)。
//
// シークレットの入力ダイアログは CodeMirror ではなく素の textarea を使う
// (平文を持つ場所を最小限にしたいので、拡張の効いたエディタを載せない)。
// MemoEditorInner の insertText / insertBlock に相当するものを、DOM に
// 触らない形でここに持つ。

export interface Insertion {
  text: string
  // 差し込んだ直後のカーソル位置 (呼ぶ側が setSelectionRange に渡す)
  cursor: number
}

// 選択範囲を insert で置き換える。
//
// from > to (下から上へ選んだ) でも、範囲が末尾を越えていても壊れないように
// 均す — state と実際の textarea がずれることは普通に起きる (非同期の
// 保存中に打鍵された、など)。
export function insertAtSelection(
  text: string,
  from: number,
  to: number,
  insert: string,
): Insertion {
  const start = clamp(Math.min(from, to), text.length)
  const end = clamp(Math.max(from, to), text.length)
  return {
    text: `${text.slice(0, start)}${insert}${text.slice(end)}`,
    cursor: start + insert.length,
  }
}

// 1 ブロックとして差し込む。前が改行でなければ改行で始め、末尾にも改行を
// 足して、周りの本文と行が混ざらないようにする (MemoEditorInner の
// insertBlock と同じ作法 — 画像や引用が前の行に食い込むのを防ぐ)。
export function insertBlockAtSelection(
  text: string,
  from: number,
  to: number,
  insert: string,
): Insertion {
  const start = clamp(Math.min(from, to), text.length)
  const prefix = start === 0 || text[start - 1] === '\n' ? '' : '\n'
  return insertAtSelection(text, from, to, `${prefix}${insert}\n`)
}

function clamp(at: number, length: number): number {
  return Math.max(0, Math.min(at, length))
}
