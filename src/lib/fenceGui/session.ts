import { changesForFence, createSession } from 'fence-kit/shell'
import type { DocLike, FenceEditor, Outgoing, Session } from 'fence-kit/shell'
import { DOC_URI, applyChanges, docOver, replaceLines } from './doc'

// 殻 (fence-kit の session) に、ノートの本文を VS Code の代わりとして渡す
// (docs/99-フェンスGUI編集計画.md)。上流 playground の src/map/host.ts の写し。
//
// 殻は操作のたびに setText で**写し**を書き換える。エディタ (CodeMirror) へ
// 当てるのは閉じるときの 1 回だけ (commitSpec) — 書き換えの経路は殻 1 本の
// ままで、undo も 1 段にまとまる
//
// playground と違うところ:
// - createFence は持たない。「図を編集」はカーソルがフェンスの中でしか押せない
// - highlight は空。エディタは殻の後ろに隠れていて、光らせても見えない

export interface FenceGuiPort {
  // 扱える言語の editor。文書に複数の図があれば、殻の一覧で選び直せる
  readonly editors: readonly FenceEditor[]
  // いまの本文の写し (全文)
  readonly text: () => string
  // 殻が書き換えた全文を写しへ返す
  readonly setText: (next: string) => void
  // いま掴んでいるフェンスの本文 1 行目 (0 始まり)
  readonly fenceLine: () => number
  // 殻の一覧で別のフェンスを選び直したとき
  readonly onBind: (line: number) => void
  // 殻の頁 (iframe) へ送る
  readonly post: (message: Outgoing) => void
}

export function createFenceGuiSession(port: FenceGuiPort): Session {
  const document = docOver(port.text)

  const lines = (): string[] => port.text().split('\n')

  const write = (next: readonly string[] | null): boolean => {
    if (next === null) {
      return false
    }
    port.setText(next.join('\n'))
    return true
  }

  return createSession<DocLike>(
    {
      post: port.post,
      // 文書は 1 つで、いつでも前に出ている。**カーソルは掴んでいるフェンスの
      // 中に置く** — 殻はカーソルのあるフェンスに結び付く
      activeEditor: () => ({
        document,
        selection: { active: { line: port.fenceLine(), character: 0 } },
      }),
      openDocument: (uri) => (uri === DOC_URI ? document : null),
      // 当てる前の照合は applyChanges の中。合わなければ false を返し、
      // 殻が「当てられませんでした」と言う (拡張と同じ約束)
      applyEdits: (target, fenceLine, edits) =>
        Promise.resolve(write(applyChanges(lines(), changesForFence(target, fenceLine, edits)))),
      replaceBody: (_target, fenceLine, count, body) =>
        Promise.resolve(write(replaceLines(lines(), fenceLine, count, body))),
      highlight: () => {},
      onBind: (_uri, line) => port.onBind(line),
    },
    port.editors,
    // 文書は 1 つに固定する (カスタムエディタと同じ形)
    { pinned: document },
  )
}
