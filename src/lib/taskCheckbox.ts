// 閲覧画面から GFM のタスクリスト (`- [ ]` / `- [x]`) を押して切り替えるための
// 本文書き換え (DB 非依存の純関数。docs/55-チェックボックス操作計画.md §3)。
//
// **パーサに聞いてから正規表現で置換する**のが要点。
//   - 正規表現だけで判定すると、コードフェンスの中の `- [ ]` を本物と読む。
//   - パーサだけでは `[ ]` が行の何桁目かが判らない。
// そこで「その行が本当にタスク項目か」は remark に確かめさせ、確かめてから
// その 1 行だけを正規表現で書き換える。

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
