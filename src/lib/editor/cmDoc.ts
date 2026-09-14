// 編集画面 (CodeMirror) の本文へ文字を差し込む小道具 (docs/93-リファクタリング計画.md §5-1)。
//
// 何を変えるか (TransactionSpec) は EditorState だけから決める純関数にし、
// view へ流す薄い包みを隣に置く。純関数の側は EditorState.create で試せる。
// 素の textarea 向けの同じ作法は editor/insertAtSelection.ts (シークレットの入力ダイアログ用)。

import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

// 選択範囲を text で置き換え、カーソルをその直後へ置く変更
export function insertTextSpec(
  state: EditorState,
  text: string,
): TransactionSpec {
  const { from, to } = state.selection.main
  return {
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  }
}

export function insertText(view: EditorView, text: string): void {
  view.dispatch(insertTextSpec(view.state, text))
  view.focus()
}

// アップロード中に本文が編集されても正しい場所を差し替えられるよう、
// 位置ではなく一意なプレースホルダ文字列を検索して置換する。
// 見つからなければ null (ユーザーがプレースホルダを消した)
export function replaceTokenSpec(
  state: EditorState,
  token: string,
  replacement: string,
): TransactionSpec | null {
  const pos = state.doc.toString().indexOf(token)
  if (pos < 0) {
    return null
  }
  return {
    changes: { from: pos, to: pos + token.length, insert: replacement },
  }
}

export function replaceToken(
  view: EditorView,
  token: string,
  replacement: string,
): void {
  const spec = replaceTokenSpec(view.state, token, replacement)
  if (spec === null) {
    return // ユーザーがプレースホルダを消した場合は何もしない
  }
  view.dispatch(spec)
}

// カーソル位置へ 1 ブロックとして差し込む文字列。前が改行でなければ改行で
// 始め、末尾にも改行を足して、周りの本文と行が混ざらないようにする
export function blockText(state: EditorState, text: string): string {
  const { from } = state.selection.main
  const prevChar = from > 0 ? state.doc.sliceString(from - 1, from) : '\n'
  const prefix = prevChar === '\n' ? '' : '\n'
  return `${prefix}${text}\n`
}

export function insertBlock(view: EditorView, text: string): void {
  insertText(view, blockText(view.state, text))
}
