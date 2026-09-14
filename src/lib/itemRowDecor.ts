// 一覧の 1 行 (ItemRow) に何を出すかの導出 (docs/23-検索結果表示モード計画.md)。
// 見た目の部品 (components/item/) から、React を持たない判断だけをここへ出した。
//
// ItemRow は検索一覧 (client の ItemList) とゴミ箱 (server の TrashList) の
// 両方から描かれるので、ここにも server-only / client-only は付けない。

import type { Item } from '@/generated/prisma/client'
import { firstThumbInfo } from '@/lib/memoImages'
import { memoPreview } from '@/lib/markdown/memoPreview'
import { memoSummary } from '@/lib/markdown/memoSummary'
import type { ViewMode } from '@/lib/viewMode'

// 画像モードは ImageMasonry が描くのでここには来ない (ItemList が
// compact に畳んでから渡す)。型で 'image' を締め出して前提を保証する
export type RowViewMode = Exclude<ViewMode, 'image'>

type RowItem = Pick<Item, 'mode' | 'url' | 'memo'>

// サムネの一辺 (px)。**行の高さに合わせる**: 小は 1 行分、中は 2 行分、
// 大は 5 行分。width/height 属性にも渡して、読み込み前から場所を取らせる
// (画像が届いた瞬間に行が飛び跳ねないように)。
export const THUMB_PX: Record<RowViewMode, number> = {
  compact: 24,
  medium: 40,
  card: 96,
}
export const THUMB_SIZE_CLASS: Record<RowViewMode, string> = {
  compact: 'size-6',
  medium: 'size-10',
  card: 'size-24',
}

// 1 枚ずつが独立したカードの枠。小表示では ul が枠を持ち区切り線で仕切るが、
// グリッドに並べるときは ul は器でしかないので、枠と地色は各カードが持つ。
// スワイプ有効時は SwipeToTrashRow の li に足すクラスとして渡す
// (見た目の定義を 2 か所に散らさない。docs/43 §9-2)
export const CARD_FRAME_CLASS = 'h-full rounded border border-gray-200 bg-white'

// 見出し・本文プレビューの中身。数式入りは KaTeX 済み HTML、それ以外は素の文字
export type RowText =
  | { kind: 'math'; html: string }
  | { kind: 'plain'; text: string }

// 見出し。
//
// 数式入りは KaTeX 済み HTML を優先する。math 側があるときは memoSummary を
// 呼ばない — この部品は client 束にも入るので、捨てるだけの本文パースを SSR と
// hydration の 2 回やらないため。
//
// 見出しが空でも文字を置く。**当たり判定のため**で、飾りではない —
// 見出しのリンクは stretched link の基準 (::after inset-0) なので、中身が
// 空だと箱ごと高さ 0 になり、行のどこを押してもノートが開かなくなる。
// 画像だけのノートやゴミ箱の空ノートで実際に起きる。
// mathTitle が来るのは要約が数式を含むとき (markdown/mathText.ts の足切り) なので、
// 「(空のノート)」の受け皿と衝突しない
export function rowTitle(item: RowItem, mathTitle?: string): RowText {
  if (mathTitle) {
    return { kind: 'math', html: mathTitle }
  }
  const text = item.mode === 'url' ? item.url : memoSummary(item.memo)
  return { kind: 'plain', text: text || '(空のノート)' }
}

// カードの本文プレビュー。URL モードのノートには本文も貼った画像も無い (memo が空)。
// 空文字なら出さない (hasRowText)
export function rowPreview(item: RowItem, mathPreview?: string): RowText {
  if (mathPreview) {
    return { kind: 'math', html: mathPreview }
  }
  return { kind: 'plain', text: item.mode === 'url' ? '' : memoPreview(item.memo) }
}

export function hasRowText(text: RowText): boolean {
  return text.kind === 'math' || text.text !== ''
}

// 行の顔 (右端のサムネ枠) に何を出すか。
//
// 顔の優先順位: 画像/動画 → 回路図 → ノート全体プレビュー (docs/68 §1、
// docs/70)。画像・回路図があるノートは今までどおりの見た目を保ち、
// 文字だけだったノートにだけ本文の縮小プレビューが加わる。
//
// サムネにできる添付 (画像 or 動画 poster)。音声・PDF・テキストは thumb を
// 持たないので対象外 (一覧では文字だけ)。動画は poster を出し、無ければ
// RowThumb がアイコンへ切り替える (41-QR-search/docs/14 §Phase4)
export type RowFace =
  | { kind: 'image'; name: string; isVideo: boolean }
  | { kind: 'circuit'; svg: string }
  | { kind: 'preview' }
  | null

export function rowFace(
  item: RowItem,
  { circuitThumb, hasNotePreview }: { circuitThumb?: string; hasNotePreview: boolean },
): RowFace {
  const thumbInfo = item.mode === 'url' ? null : firstThumbInfo(item.memo)
  if (thumbInfo) {
    return { kind: 'image', name: thumbInfo.name, isVideo: thumbInfo.isVideo }
  }
  if (circuitThumb) {
    return { kind: 'circuit', svg: circuitThumb }
  }
  return hasNotePreview ? { kind: 'preview' } : null
}

// タグの行を出すか。
//
// **小 (compact) ではタグを出さない。** 1 ノート 1 行に詰めて一覧性を
// 優先する — 小は「並べて番号や見出しを拾う」ための表示で、タグは中・大と
// ノート本体、それにフォルダーペイン (docs/86 §5) で見られる
export function showsRowTags(view: RowViewMode, tags: readonly string[]): boolean {
  return view !== 'compact' && tags.length > 0
}

// 枠内のどこを押してもノートが開くようにする (stretched link)。
//
// 行全体を <a> で包むことはできない。タグは別の行き先 (タグ検索) を持つので
// リンクの入れ子になり、HTML として不正で挙動も壊れる。そこでリンクは
// タイトルの 1 つに保ったまま、その ::after を枠いっぱいに広げて当たり判定
// だけを大きくする。href は本物のリンクのままなので、中クリックで新しいタブ・
// 右クリックで URL コピーも今までどおり効く。
//
// 上に出したい物 (タグ・補助行) は relative z-10 で膜より前に出す。
//
// **選択モードでは敷かない。** チェックボックスまで膜が覆って押せなくなる
// うえ、選んでいる最中に枠へ触れるたびノートへ飛んでしまう
export function stretchedLinkClass(isSelecting: boolean): string {
  return isSelecting ? '' : 'after:absolute after:inset-0'
}

// プレビューで開いている行の地色 (docs/86 §4)。選択中は hover ごと選択色に
// 寄せる — hover の灰色に負けると、触れるたびに目印が消える。
//
// 色は CSS 変数で受ける (docs/88-選択行の色計画.md)。利用者が選んだ色を
// layout.tsx が html に立て、既定は globals.css の :root が持つ。
// クラス名を色ごとに書き分けない — Tailwind はソース中の完全なクラス名しか
// 拾わないので、6 色ぶんを全部並べることになる
export function rowTintClass(selected: boolean): string {
  return selected
    ? 'bg-[var(--row-tint-bg)] hover:bg-[var(--row-tint-bg)] active:bg-[var(--row-tint-active)]'
    : 'hover:bg-gray-50 active:bg-gray-100'
}
