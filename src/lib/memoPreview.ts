// 検索結果のカード表示で、タイトル・タグの下に出す本文プレビュー
// (docs/23-検索結果表示モード計画.md §3)。
//
// カードには 3 行分の枠がある。そこへ「もう他の場所で見えているもの」を流すと
// 枠が無駄になるため、次の 3 つを落として本文だけを残す:
//   - 1 行目 … タイトルとして 1 行目に出ている (memoSummary と同じ行)
//   - タグだけの行 … タグとして 2 行目に出ている
//   - プロパティ行 (key=value) … タグ検索なら特性表 (PropsTable) に出ている
//   - 画像 … サムネとしてカード右端に出ている
//
// 行数は数えず、残った行を空白で連結して返す。Markdown 上の 1 行は画面では
// 折り返して 2 行にも 3 行にもなるので、「3 行に収める」のは line-clamp の仕事。
// ここは「3 行を埋めるのに十分なテキスト」を渡すことだけを受け持つ。

import { isStructureLine, stripLineMarkdown } from './memoSummary'
import { isPropLine } from './props'
import { parseTagToken } from './tags'

// プレビューとして返す最大文字数。
//
// 表示は 3 行 (line-clamp-3) で、カード幅なら 1 行 40〜60 字。3 行を埋めるには
// 200 字あれば足りる。上限を設けるのは、line-clamp が隠すのは見た目だけで、
// 本文が 50KB あればその 50KB が DOM とサーバ→クライアントのペイロードに
// そのまま乗るため。1 ページ 20 件ぶん積まれるので効く。
export const MEMO_PREVIEW_MAX_LENGTH = 200

// 画像 (`![alt](url)`)。memoSummary は alt テキストを残すが、プレビューでは
// 絵ごと落とす — サムネがカード右端に出ているので、alt は重複でしかない。
const IMAGE_SYNTAX = /!\[[^\]]*\]\([^)]*\)/g

// 半角空白 (\s) と全角空白 (　) の連続。props.ts の TOKEN_SEPARATOR と揃える。
const TOKEN_SEPARATOR = /[\s　]+/
const WHITESPACE_RUN = /[\s　]+/g

// 行全体がタグだけで出来ているか (`#bjt #npn`)。
// 散文に混じったタグ (`これは #npn のトランジスタ`) は本文なので残す。
function isTagOnlyLine(line: string): boolean {
  const tokens = line.split(TOKEN_SEPARATOR).filter((token) => token.length > 0)
  return (
    tokens.length > 0 && tokens.every((token) => parseTagToken(token) !== null)
  )
}

export function memoPreview(memo: string): string {
  const parts: string[] = []
  let length = 0
  // 1 行目 (タイトル) を跨いだか。memoSummary と同じ手順で見つけることで、
  // カードのタイトルに出ている行をちょうど 1 つだけ飛ばす
  let titlePassed = false

  for (const line of memo.split(/\r?\n/)) {
    if (isStructureLine(line)) {
      continue
    }

    if (!titlePassed) {
      // memoSummary が返すのは「最初の中身のある行」。その行がタイトル
      if (stripLineMarkdown(line) === '') {
        continue
      }
      titlePassed = true
      continue
    }

    if (isPropLine(line) || isTagOnlyLine(line)) {
      continue
    }

    // 画像を抜いた跡に空白が残る (`左 ![alt](url) 右` → `左   右`) ので畳む。
    // 連結後は 1 続きの文として流し込むため、行内の空きは 1 つで足りる
    const text = stripLineMarkdown(line.replace(IMAGE_SYNTAX, ' '))
      .replace(WHITESPACE_RUN, ' ')
      .trim()
    if (text === '') {
      continue
    }

    parts.push(text)
    // 連結後の長さ (+ 区切りの空白)。上限を超えたらそれ以上読む意味がない
    length += text.length + (parts.length > 1 ? 1 : 0)
    if (length > MEMO_PREVIEW_MAX_LENGTH) {
      break
    }
  }

  const preview = parts.join(' ')
  return preview.length > MEMO_PREVIEW_MAX_LENGTH
    ? `${preview.slice(0, MEMO_PREVIEW_MAX_LENGTH)}…`
    : preview
}
