// 閲覧画面から GFM のタスクリスト (`- [ ]` / `- [x]`) を押して切り替えるための
// 本文書き換え (DB 非依存の純関数。docs/55-チェックボックス操作計画.md §3)。
//
// **パーサに聞いてから正規表現で置換する**のが要点。
//   - 正規表現だけで判定すると、コードフェンスの中の `- [ ]` を本物と読む。
//   - パーサだけでは `[ ]` が行の何桁目かが判らない。
// そこで「その行が本当にタスク項目か」は remark に確かめさせ、確かめてから
// その 1 行だけを正規表現で書き換える。

import type { ListItem } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { joinLines, splitLines } from './memoLines'

// 行頭からチェック印までを 3 つに割る。
//   $1 = 記号までの前置き + `[` / $2 = 印 (空白 or x) / $3 = `]` + 直後の空白
// 前置きに許すもの: 入れ子のインデント、引用の `>`、箇条書き記号 (- * +)、
// 番号付き (1. / 1))。GFM は `]` の後に空白を要求する (`- [ ]apple` は
// タスクではない) ので、そこまでを含めて一致させる。
//
// 似た前置きの正規表現が memoSummary.ts の LINE_PREFIX にもあるが、あちらは
// 一覧の要約で飾りを**削る**ためのもの。こちらは書き換える桁を知るために
// 割る必要があるので、共有せず別に持つ。
const TASK_MARKER_RE = /^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\][ \t])/

// 解析は毎回同じ構成なので使い回す。MarkdownView は他にも remark プラグインを
// 挟むが、いずれも listItem の位置は動かさないので gfm だけで足りる
const MEMO_PARSER = unified().use(remarkParse).use(remarkGfm).freeze()

// その行 (1 始まり) が GFM のタスク項目かをパーサに確かめる
function isTaskLine(memo: string, line: number): boolean {
  const tree = MEMO_PARSER.parse(memo)
  let found = false
  visit(tree, 'listItem', (node) => {
    // checked が null なら「ただの箇条書き」。true/false だけがタスク項目
    if (node.checked != null && node.position?.start.line === line) {
      found = true
      return false // 見つかったら歩くのをやめる (EXIT)
    }
  })
  return found
}

// 行頭の判定を全行に当てるための同じ規則 (m フラグ付き)。**行末はそのまま**
// なので、CRLF と LF の違いは「同じ」に丸めない
const TASK_MARK_LINE_RE = new RegExp(TASK_MARKER_RE.source, 'gm')

// 2 つの本文が「チェック印 (`[ ]` / `[x]`) の違いだけ」かを見る
// (docs/87-編集競合対策計画.md §2-5)。
//
// 使いどころは modifyMemo の再試行の門番。チェックの切り替えは**行番号で**
// 対象を指すので、読み直した本文で行が増減していると、ずれた先が偶然タスク行
// だったときに別の項目を裏返してしまう。印だけの違いなら行番号は動いていない。
//
// パーサには聞かない (印を揃えて突き合わせるだけ)。コードフェンスの中の
// 擬似タスクまで揃えることになるが、この門番は「押してよいか」ではなく
// 「行がずれていないか」を見るものなので、揃えておく方が安全側に倒れる
// (押せるかどうかは toggleTaskLine が別途パーサで確かめる)。
export function differsOnlyInTaskMarks(a: string, b: string): boolean {
  return normalizeTaskMarks(a) === normalizeTaskMarks(b)
}

function normalizeTaskMarks(memo: string): string {
  return memo.replace(TASK_MARK_LINE_RE, '$1 $3')
}

// 本文が持つタスク項目の数 (docs/56-チェック検索計画.md §2)。
// items.task_todo / task_done の派生キャッシュの元になる。
//
// **判定はパーサ基準**なので、コードフェンスの中の `- [ ]` は数えない
// (toggleTaskLine と同じ物差し。押せるもの = 数えるもので一貫させる)。
// シークレット断片の中のチェックは本文上は暗号文なので数えられない — 断片内は
// 閲覧でも押せない (docs/55 §5) ので、ここでも同じく対象外になる。
export function countTasks(memo: string): { todo: number; done: number } {
  const tree = MEMO_PARSER.parse(memo)
  let todo = 0
  let done = 0
  visit(tree, 'listItem', (node) => {
    // checked が null なら「ただの箇条書き」。true/false だけがタスク項目
    if (node.checked === true) {
      done++
    } else if (node.checked === false) {
      todo++
    }
  })
  return { todo, done }
}

// 名前の付いたチェック 1 つ (docs/77-進捗マトリックス計画.md §4)
export interface CheckState {
  // 書かれたままの名前 (前後の空白だけ落とす)。照合は
  // normalizeCheckLabel (matrixFence.ts) を通してから行う
  label: string
  checked: boolean
}

// 本文が持つチェック項目を、名前付きで文書順に返す。
//
// countTasks が個数しか持たないのに対し、こちらは**どのチェックか**を返す。
// 「学習済みは付いたが自信ありは付いていない」は個数では区別できない
// (どちらも todo 1 / done 1) ため、進捗の表はこちらを使う。
//
// 物差しは countTasks と同じパーサ基準なので、コードフェンスの中の擬似タスクを
// 拾わないことも、シークレット断片の中を見ないことも自動で揃う。
export function checkStates(memo: string): CheckState[] {
  const tree = MEMO_PARSER.parse(memo)
  const states: CheckState[] = []
  visit(tree, 'listItem', (node) => {
    if (node.checked == null) {
      return
    }
    states.push({ label: listItemLabel(node), checked: node.checked })
  })
  return states
}

// 項目の見出しになる文字列。**最初の子 (段落) だけ**から取るのが要点で、
// 項目まるごとから取ると入れ子のタスクの文字まで混ざり、外側の名前が
// 一致しなくなる。空行入りのゆるいリストでも最初の子は段落のまま
function listItemLabel(node: ListItem): string {
  const first = node.children[0]
  if (first === undefined || first.type !== 'paragraph') {
    return ''
  }
  let text = ''
  visit(first, (child) => {
    if (child.type === 'text' || child.type === 'inlineCode') {
      text += child.value
    }
  })
  return text.trim()
}

// line 行目のタスク項目を checked の状態にした本文を返す。
// その行がタスク項目でなければ null (行番号が古い = 本文が変わった印)。
// 既に望む状態なら、渡された本文と同じ文字列がそのまま返る (呼び手は保存を省ける)。
export function toggleTaskLine(
  memo: string,
  line: number,
  checked: boolean,
): string | null {
  if (!Number.isInteger(line) || line < 1) {
    return null
  }
  const lines = splitLines(memo)
  const target = lines[line - 1]
  // 見た目からして違う行は、解析するまでもなく弾く
  if (target === undefined || !TASK_MARKER_RE.test(target)) {
    return null
  }
  // 見た目が合っていてもコードフェンスの中かもしれないので、パーサに確かめる
  if (!isTaskLine(memo, line)) {
    return null
  }
  lines[line - 1] = target.replace(
    TASK_MARKER_RE,
    `$1${checked ? 'x' : ' '}$3`,
  )
  return joinLines(lines, memo)
}
