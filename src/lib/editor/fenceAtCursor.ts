import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

// カーソルのあるフェンス (docs/99-フェンスGUI編集計画.md §5)。
// 下部バーの「図を編集」が押せるかを決め、押したときに殻へ渡す行を返す。
//
// **範囲は構文木、言語は上流の規則で読む。** 殻 (fence-kit の extractFences) は
// 開きの行を「行頭から字下げ 3 つまで」「情報文字列の先頭の語が綴りどおり」で
// 拾う。ライブプレビューの drawableFence は字下げも大文字小文字も緩く見るが、
// ここで同じにすると、押せるのに殻が「フェンスを見失いました」と言う

export interface FenceAtCursor {
  // 開きの行の言語 (先頭の語)。殻が拾えない開き (引用の中など) は ''
  readonly lang: string
  // 本文 1 行目の行番号 (0 始まり)。殻の fenceLine にそのまま渡す
  readonly bodyLine: number
}

// fenceBlocks.ts と同じ予算。構文木は差分で保たれるので、2 回目からは安い
const PARSE_BUDGET_MS = 200

// 上流の FENCE_LINE と同じ形 (packages/fence-kit/src/fences.ts)
const OPENING = /^ {0,3}(?:`{3,}|~{3,})\s*(.*)$/

function openingLang(lineText: string): string {
  const info = OPENING.exec(lineText)?.[1]
  return info === undefined ? '' : (info.trim().split(/\s+/)[0] ?? '')
}

// 構文木の節。@lezer/common は package.json に無い (CodeMirror が連れてくる)
// ので、名前で読まずに syntaxTree の戻りから引く
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

function enclosingFence(node: SyntaxNode | null): SyntaxNode | null {
  let current = node
  while (current !== null && current.name !== 'FencedCode') {
    current = current.parent
  }
  return current
}

export function fenceAtCursor(state: EditorState): FenceAtCursor | null {
  const tree =
    ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state)
  const { head } = state.selection.main
  // 左 (-1) を先に見る — 閉じの行の末尾は左にしかフェンスが無い。
  // 開きの行の頭は左だと前の段落に付くので、右 (1) も見る
  const fence =
    enclosingFence(tree.resolveInner(head, -1)) ??
    enclosingFence(tree.resolveInner(head, 1))
  if (fence === null) {
    return null
  }
  const opening = state.doc.lineAt(fence.from)
  return {
    lang: openingLang(opening.text),
    // 開きの行の番号 (1 始まり) = 本文 1 行目の番号 (0 始まり)
    bodyLine: opening.number,
  }
}
