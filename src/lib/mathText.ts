// 一覧 (タイトル・本文プレビュー・特性表の要約) のインライン数式を
// サーバ側で KaTeX の HTML にする (docs/69-一覧数式計画.md)。
//
// ノート表示 (MarkdownView) は remark-math + rehype-katex で描くが、一覧は
// markdown を描かずプレーンテキストに畳んでいる (memoSummary / memoPreview)。
// そのテキストに残る $...$ だけをここで KaTeX に通し、地の文はエスケープして
// HTML 文字列に組み立てる。表示側 (MathText.tsx) は埋め込むだけ —
// 回路図サムネ (circuitThumbs.ts + CircuitThumb.tsx) と同じ型。
//
// このモジュールはサーバ専用にする (katex ~280KB をクライアント束に入れない)。
// client component からは型だけ import すること (circuitThumbs.ts と同じ線引き)
import katex from 'katex'
import { escapeHtml } from './escapeHtml'
import { KATEX_OPTIONS } from './katexOptions'
import { memoPreview } from './memoPreview'
import { inlineMathRanges, memoSummary } from './memoSummary'

// itemNo → 数式入りのタイトル/プレビュー (KaTeX 済み HTML)。数式の無い
// フィールドは持たない (表示側がプレーンテキストへフォールバック)。
// サーバ→クライアント境界を越える prop なので素の Record
export type MathTextMap = Record<string, { title?: string; preview?: string }>

// title … 小/画像モード用。プレビューはどの行にも描かれないので作らない
// both  … カード表示用。タイトルと本文プレビューの両方
export type MathTextMode = 'title' | 'both'

// 1 フィールドの HTML 上限。KaTeX の HTML はソースの数倍〜十数倍に膨らみ、
// SSR の HTML と hydration 用 Flight payload の両方に載る (circuitThumbs の
// 予算と同じ事情)。超えたらプレーンテキストのまま出す
const MAX_MATH_HTML_CHARS = 16 * 1024

// 1 レスポンスの合計予算。searchItems は「さらに表示」で 1〜N ページの
// 累積を返すため件数に上限が無い (CIRCUIT_THUMB_BUDGET と同じ事情)。
// 一覧の先頭から詰めて、超過した分はプレーンテキストへ静かに劣化する
export const MATH_TEXT_BUDGET = 256 * 1024

// text 中の $...$ を KaTeX で描画した HTML を返す。数式が無ければ null。
// throwOnError: false はノート表示 (rehype-katex 既定) と同じ
// 「構文エラーは赤字でソース表示」。それ以外の想定外の失敗も一覧を
// 壊さないよう null (プレーンテキスト) に畳む
export function renderInlineMathHtml(text: string): string | null {
  if (!text.includes('$')) {
    return null
  }
  const ranges = inlineMathRanges(text)
  if (ranges.length === 0) {
    return null
  }

  let html = ''
  let pos = 0
  try {
    for (const range of ranges) {
      html += escapeHtml(text.slice(pos, range.start))
      // 区切りの $ を除いた中身だけを KaTeX へ
      const tex = text.slice(range.start + 1, range.end - 1)
      html += katex.renderToString(tex, {
        ...KATEX_OPTIONS,
        throwOnError: false,
      })
      pos = range.end
      // 上限は 1 枚描くごとに見る。超えることが確定してから残りを描いても
      // 全部捨てるだけ (KaTeX は 1 式 1ms 級とはいえ塵も積もる)
      if (html.length > MAX_MATH_HTML_CHARS) {
        return null
      }
    }
  } catch {
    return null
  }
  html += escapeHtml(text.slice(pos))

  return html.length > MAX_MATH_HTML_CHARS ? null : html
}

// 一覧に必要な列だけに絞る (circuitThumbs.ts と同じ)
type MathSource = { itemNo: string; memo: string; mode: string }

// ページ内アイテムのタイトル (と mode='both' ならプレビュー) の数式を
// まとめて HTML 化する。DB は引かない同期処理。$ を含まないノートは
// memoSummary / memoPreview を呼ぶまでもなく飛ばし、合計予算を超えたら
// 残りはプレーンテキストのまま (一覧の先頭から詰める)
export function buildMathTexts(
  items: readonly MathSource[],
  mode: MathTextMode,
): MathTextMap {
  const map: MathTextMap = {}
  let budget = MATH_TEXT_BUDGET
  for (const item of items) {
    if (budget <= 0) {
      break
    }
    if (item.mode === 'url' || !item.memo.includes('$')) {
      continue
    }
    const title = renderInlineMathHtml(memoSummary(item.memo))
    const preview =
      mode === 'both' ? renderInlineMathHtml(memoPreview(item.memo)) : null
    if (title !== null || preview !== null) {
      budget -= (title?.length ?? 0) + (preview?.length ?? 0)
      map[item.itemNo] = {
        ...(title !== null && { title }),
        ...(preview !== null && { preview }),
      }
    }
  }
  return map
}

// 特性表の要約列 (itemNo → HTML)。`titles` (buildMathTexts の結果) を渡すと、
// 同じ文字列 (summary は memoSummary と同一) の描画を使い回して二重描画を
// 避ける。数式の無い行は入れない — 表示側はプレーンテキストのまま
export function buildMathSummaries(
  rows: readonly { itemNo: string; summary: string }[],
  titles?: MathTextMap,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const row of rows) {
    if (!row.summary.includes('$')) {
      continue
    }
    const html = titles?.[row.itemNo]?.title ?? renderInlineMathHtml(row.summary)
    if (html !== null) {
      map[row.itemNo] = html
    }
  }
  return map
}
