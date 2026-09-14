// 検索ページ ((search)/page.tsx) の結果部分が描く材料を引いて組み立てる
// (docs/93-リファクタリング計画.md §4-8)。DB 問い合わせと派生計算だけで、
// JSX は持たない — 部品 (HomeResults) の中にあった頃はテストできなかった。
import 'server-only'
import { cache } from 'react'
import { buildNotePreviews, type NotePreviewMap } from '@/components/item/NotePreviewThumb'
import type { CircuitThumbMap } from '@/lib/circuit/types'
import { loadCircuitThumbs } from '@/lib/circuit/thumbs'
import { nextItemNo } from '@/lib/items/read'
import {
  countTaskProgress,
  searchItemProps,
  searchItems,
  type ItemPropsResult,
  type ItemSearchResult,
  type TaskProgress,
} from '@/lib/items/search'
import { countTrashedItems, countTrashedMatches } from '@/lib/items/trash'
import { buildMathSummaries, buildMathTexts } from '@/lib/markdown/mathText'
import type { MathTextMap } from '@/lib/markdown/mathTextTypes'
import { queryHasTagTerm, queryTracksTaskProgress } from '@/lib/search/rewrite'
import { isTaggableCode, scanRegisterHref } from '@/lib/external/scanRegister'
import type { Sort } from '@/lib/validation'
import type { ViewMode } from '@/lib/prefs/viewMode'

// ゴミ箱の件数は HomeResults (0 件時の案内) と SearchFolders (フォルダーの
// バッジ) の両方が使う。別々の Suspense 枝から呼んでも 1 回の問い合わせに
// 畳むため、リクエスト単位で memo する (React の cache)
export const countTrashedItemsOnce = cache(countTrashedItems)

export interface SearchResultsInput {
  query: string
  // `?page=` の生の値。数でなければ 1 ページ目
  page: string
  sort: Sort
  view: ViewMode
}

export interface SearchResultsData {
  result: ItemSearchResult
  props: ItemPropsResult
  trashCount: number
  progress: TaskProgress
  registerHref: string | null
  trashedMatches: number
  circuitThumbs: CircuitThumbMap
  mathTexts: MathTextMap
  mathSummaries: Record<string, string>
  notePreviews: NotePreviewMap
}

export async function loadSearchResults({
  query,
  page,
  sort,
  view,
}: SearchResultsInput): Promise<SearchResultsData> {
  // 特性表はタグ検索のときだけ出す。表は「同族の部品を並べて比べる」ビューで、
  // タグ検索がまさにその族の指定だから (docs/08-プロパティ計画.md §4)。
  const showProps = queryHasTagTerm(query)
  // 学習の進捗はチェック状態で絞り込んでいるときだけ数える
  // (docs/60-学習進捗計画.md §2)。常時出すと、チェックを使っていない
  // ノート群にも 0% が並ぶ
  const showProgress = queryTracksTaskProgress(query)
  const [result, props, trashCount, progress] = await Promise.all([
    searchItems(query, Number(page) || 1, sort),
    showProps
      ? searchItemProps(query, sort)
      : Promise.resolve({ rows: [], omitted: 0 }),
    countTrashedItemsOnce(),
    showProgress
      ? countTaskProgress(query)
      : Promise.resolve({ done: 0, total: 0 }),
  ])

  // 0 件のときだけ引く 2 つ。どちらも独立なので並べて撃つ。
  // - 採番: スキャンした未登録コードから新規ノートを作る導線
  //   (docs/10-スキャン新規登録計画.md §3)。タグにできる語のときだけ。
  //   ヒットした検索や URL・複数語では引かない (無駄な問い合わせをしないためと、
  //   ボタンを出さないため)
  // - ゴミ箱の一致: 消したノートを探して 0 件のときに知らせる
  //   (docs/12-ゴミ箱計画.md §5)。ゴミ箱が空なら数えるまでもない
  const [nextNo, trashedMatches] = await Promise.all([
    result.total === 0 && isTaggableCode(query) ? nextItemNo() : null,
    result.total === 0 && trashCount > 0 ? countTrashedMatches(query) : 0,
  ])
  const registerHref = nextNo === null ? null : scanRegisterHref(nextNo, query)

  // 一覧に出す回路図サムネ (docs/68-一覧回路図サムネ計画.md)。キャッシュ済みの
  // SVG を引くだけで描画はしない。小/大は画像の無いノートの先頭 1 枚、
  // 画像モードは全部 (表示モードはサーバで既知なので引く量を絞れる)
  const circuitThumbs = await loadCircuitThumbs(
    result.items,
    view === 'image' ? 'all' : 'first',
  )

  // タイトル・プレビューの数式を KaTeX の HTML に (docs/69-一覧数式計画.md)。
  // DB は引かない同期処理。プレビューが描かれるのはカード表示だけなので、
  // それ以外はタイトルだけ作る (circuitThumbs の mode と同じ考え)。
  // 特性表の要約列はタイトルと同じ文字列なので描画を使い回す
  const mathTexts = buildMathTexts(
    result.items,
    view === 'card' ? 'both' : 'title',
  )
  const mathSummaries = buildMathSummaries(props.rows, mathTexts)

  // 画像も回路図も無いノートの顔になる、本文の縮小プレビュー
  // (docs/71-一覧ノートプレビュー計画.md)。DB は引かない同期処理。
  // **回路図サムネの後に作る** (出るノートに作っても使われない)。
  // 表示モードごとの出し分け (画像モードは作らない・小はさらに足切り) は
  // buildNotePreviews の中 (circuitThumbs / mathTexts と同じ作法)
  const notePreviews = buildNotePreviews(result.items, circuitThumbs, view)

  return {
    result,
    props,
    trashCount,
    progress,
    registerHref,
    trashedMatches,
    circuitThumbs,
    mathTexts,
    mathSummaries,
    notePreviews,
  }
}
