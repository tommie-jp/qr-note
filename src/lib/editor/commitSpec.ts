import { isolateHistory } from '@codemirror/commands'
import type { EditorState, TransactionSpec } from '@codemirror/state'

// 図の編集 (docs/99-フェンスGUI編集計画.md §5) を閉じたとき、殻が書き換えた
// 全文をエディタへ当てる形。
//
// 殻は開いている間、本文の**写し**を操作のたびに書き換える (上流の約束:
// 書き換えの経路は殻 1 本)。エディタへは閉じるときに 1 回だけ当てるので、
// 元に戻す 1 段で開く前へ戻る。
//
// 当てるのは開いたときの本文から**変わらずにいるとき**だけ。開いている間は
// モーダルが画面を塞ぐが、外から本文が差し替わる道 (編集競合の取り込みなど)
// は残っている。そのときに位置で当てると、別の所を書き換える
export type CommitResult =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'change'; readonly spec: TransactionSpec }

export function commitSpec(
  before: string,
  after: string,
  state: EditorState,
): CommitResult {
  if (state.doc.toString() !== before) {
    return { kind: 'stale' }
  }
  if (before === after) {
    return { kind: 'unchanged' }
  }
  // 共通の頭と尻を除いた 1 か所だけを変える。全文を差し替えると、
  // カーソルもスクロールも先頭へ飛ぶ
  const limit = Math.min(before.length, after.length)
  let head = 0
  while (head < limit && before[head] === after[head]) {
    head++
  }
  // 尻は頭と重ならない所まで (重ねると from > to になる)
  let tail = 0
  while (
    tail < limit - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }
  return {
    kind: 'change',
    spec: {
      changes: {
        from: head,
        to: before.length - tail,
        insert: after.slice(head, after.length - tail),
      },
      // 直前の打鍵と 1 段にまとめない (開いてから閉じるまでが 1 つの操作)
      annotations: isolateHistory.of('full'),
    },
  }
}
