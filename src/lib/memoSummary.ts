// 一覧の要約表示用に、memo の先頭行から Markdown 記法を取り除く。
// 表示専用の簡易変換 (正確なパースは表示側の react-markdown が担う)

import { readAlertMarker } from './markdownAlerts'

// 行頭の記法: 見出し / 引用 / 箇条書き / 番号リスト / チェックボックス /
// 脚注の定義 (`[^1]: 出典`)
const LINE_PREFIX =
  /^\s*(?:#{1,6}\s+|>\s*|\[\^[^\]]+\]:\s*|(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s*)?)/

// インライン記法 → 中身のテキストだけ残す。
// 単独アンダースコアの強調 (_em_) は部品名 (ABC_DEF) と衝突するため対象外
const INLINE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'], // 画像 → alt テキスト
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'], // リンク → リンクテキスト
  [/(\*\*|__)(.*?)\1/g, '$2'], // 太字
  [/\*(.*?)\*/g, '$1'], // 斜体 (*)
  [/~~(.*?)~~/g, '$1'], // 取り消し線
  [/`([^`]*)`/g, '$1'], // インラインコード
  [/\[\^[^\]]+\]/g, ''], // 脚注の参照 (`本文[^1]`) → 番号ごと落とす
]

// コードフェンスの区切り行 (```lang / ~~~)。中身ではないので飛ばす。
const FENCE_MARKER = /^\s*(```|~~~)/

// 折りたたみの区切り行 (`:::details` / `:::`。docs/54-markdown表示拡張計画.md §4)
const DIRECTIVE_MARKER = /^\s*:{3,}/

// 折りたたみのラベル付きの開き行 (`:::details[長いログ]`)。
// **ラベルは書き手が付けた見出しそのもの**なので、囲いとして捨てずに中身として
// 扱う — 捨てると、要約に出るのは折り畳んで隠したはずの 1 行目になる
const DIRECTIVE_LABEL = /^\s*:{3,}[\w-]*\[(.*)\]\s*$/

// 中身ではなく囲い (フェンス・折りたたみ) の行か。
// 要約もプレビューも同じ判断を使う — 片方だけ直すと一覧の 1 行目と
// その下のプレビューで別の行が選ばれる
export function isStructureLine(line: string): boolean {
  if (DIRECTIVE_LABEL.test(line)) {
    return false
  }
  return FENCE_MARKER.test(line) || DIRECTIVE_MARKER.test(line)
}

// 1 行から Markdown 記法を取り除いて表示用のテキストにする。
// memoPreview (一覧の本文プレビュー) も同じ剥がし方を使うので公開している。
export function stripLineMarkdown(line: string): string {
  // 折りたたみのラベルは、囲いを外した中身として扱う
  let text = DIRECTIVE_LABEL.exec(line)?.[1] ?? line
  // 引用の入れ子 (> > ...) などに備えて、変化しなくなるまで行頭記法を剥がす。
  // アラートの目印 (`> [!NOTE]`) は引用を剥がした後に現れるので同じ輪の中で見る
  for (let prev = ''; prev !== text; ) {
    prev = text
    text = text.replace(LINE_PREFIX, '')
    text = readAlertMarker(text)?.rest ?? text
  }
  for (const [pattern, replacement] of INLINE_PATTERNS) {
    text = text.replace(pattern, replacement)
  }
  return text.trim()
}

export function memoSummary(memo: string): string {
  for (const line of memo.split(/\r?\n/)) {
    if (isStructureLine(line)) {
      continue
    }
    const text = stripLineMarkdown(line)
    if (text) {
      return text
    }
  }
  return ''
}
