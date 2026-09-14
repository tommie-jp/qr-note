import Link from "next/link";
import {
  bulkTagAction,
  setItemsOfflinePinAction,
  setSortAction,
  setViewModeAction,
  trashItemsAction,
} from "@/app/actions";
import { AutoLoadMore } from "@/components/AutoLoadMore";
import { ItemDetail } from "@/components/ItemDetail";
import { ItemList } from "@/components/ItemList";
import { TrashIcon } from "@/components/icons";
import { PropsTable } from "@/components/PropsTable";
import { ResultsToolbar } from "@/components/ResultsToolbar";
import { SearchResults } from "@/components/SearchNav";
import { TaskProgress } from "@/components/TaskProgress";
import { showsAutoNote, type PaneMode } from "@/lib/prefs/paneMode";
import { loadSearchResults } from "@/lib/search/pageData";
import { buildSearchUrl } from "@/lib/search/url";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/prefs/viewMode";

// 検索の重い部分 (DB 問い合わせと結果表示) をまとめた非公開のサーバ
// コンポーネント。Home 本体はここを await しないので、固定部が先に流れる。
// 何を引くか (条件つきの問い合わせと派生計算) は lib/search/pageData.ts
export async function HomeResults({
  query,
  page,
  sort,
  view,
  paneMode,
}: {
  query: string;
  page: string;
  sort: Sort;
  view: ViewMode;
  paneMode: PaneMode;
}) {
  const {
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
  } = await loadSearchResults({ query, page, sort, view });

  // ノートのペインを持つ構成 (3 / 2) では**必ずノートを出す**
  // (docs/86 §4-4)。まだ何も選んでいないときのために、検索結果の先頭を
  // 器ごと用意しておく。
  //
  // URL は動かさない — router.replace で /item/<先頭> へ飛ばすと、
  // 再読み込みした瞬間に横取りの外 (全画面のノート) へ着地して 3 ペインが
  // 消える。ここで描けば URL は検索のまま保てる。
  // 中身の重さは一覧のプレビュー (buildNotePreviews は最大 20 ノートぶんの
  // markdown を描く) と同じ桁で、1 ノート増えるだけ。
  // 中身は横取りしたペイン ((search)/@detail/(.)item/[itemNo]/page.tsx) と
  // 同じ組み合わせを、同じ部品 (ItemDetail) で組み立てる
  const first = showsAutoNote(paneMode) ? result.items[0] : undefined;
  const autoNote = first ? (
    <ItemDetail
      itemNo={first.itemNo}
      q={query}
      sort={sort}
      shell={{ kind: "auto" }}
    />
  ) : null;

  // カード・masonry は広い画面で列を増やしたいので広幅。compact の
  // 1 カラムだけは読み幅を保つ (docs/23 §1, docs/32 §1)
  return (
    <>
    {/* 3 ペインでまだ何も選んでいないときに出す、先頭ノートのペイン
        (docs/86 §4-4)。**SearchResults の外に置く** — あちらはカード表示で
        breakout の transform を持ち、transform のある要素は position:fixed の
        包含ブロックになる (下部バーを nav の外へ出しているのと同じ罠)。
        中に入れるとペインが一覧の幅の中へ縮んで浮く。
        出すかどうかの最終判断はクライアント側 (AutoNotePane) —
        横取りスロットが既にノートを持っていたら引っ込む */}
    {autoNote}
    {/* 幅の指定は持たない。ペイン 2 の器いっぱいに広げる (docs/86 §4-8) —
        広幅 breakout (WIDE_RESULTS_CLASS) は「中央 max-w-2xl の器から
        はみ出す」ための道具で、器がもうペイン幅いっぱいなら要らない */}
    <SearchResults query={query}>
      {/* 並び順は下部バーへ移したので、この行は件数と補助リンクだけになった
          (docs/31-下部操作バー計画.md §2)。
          件数は text-sm、その脇の補助リンクはさらに一段下げて text-xs。
          両方同じ大きさにすると、件数 (常に見る物) と補助リンク
          (たまに押す物) の区別が付かなくなる */}
      {/* 件数と補助リンクは左、一覧に効く操作 (表示・並び順・選択) は右
          (docs/86 §4-11)。**p ではなく div**  — 中に form を持つので、
          段落の中に置くと HTML として不正になる */}
      {/* @container … 中のスロットが「ペインの幅」で文字数を決める基準
          (docs/86 §4-14)。**画面幅ではなくここを見るのが要点** —
          3 ペインの一覧は境界のドラッグで細くなるので、画面幅で切ると
          フォルダーを広げたときに効かない。
          この器に fixed の子孫は居ない (スロットのメニューは absolute) ので、
          container が包含ブロックになる副作用は踏まない。
          **1 行に保つ** … スロット側は whitespace-nowrap + shrink-0 で
          折り返さないので、詰まったときに譲るのは件数の側。

          件数は flex-1 (= flex-basis:0)。**0 にするのが要点** — flex-wrap の
          折り返しは「縮める前の大きさ」で決まるので、既定の basis:auto だと
          件数の全文が入らない時点でスロットが 2 行目へ落ちる。基準を 0 に
          すれば、まず件数が truncate で詰まり、**スロットまで入らなくなって
          初めて**折り返す。min-w-0 が無いと flex の子は中身より縮まないので
          truncate も効かない。

          flex-wrap は最後の逃げ道。3 ペインを 390px の画面で選ぶと一覧は
          134px まで細り、どう削ってもこの行は入らない (実測)。そこで
          nowrap のままだと選択ボタンが器の外へ出て押せなくなる —
          2 行になるほうがまだ使える。**横スクロールにはしない**:
          overflow-x は overflow-y も殺すので、長押しメニューが切られる
          (docs/74 と同じ罠) */}
      <div className="@container flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <span className="min-w-0 flex-1 truncate">
          {query ? `「${query}」の検索結果: ` : "すべて: "}
          {result.total} 件
        </span>
        {/* **絵と記号に詰める** (件数の行を短くするため)。ここは件数を読みに
            来る行で、補助リンクは「あることを知っている人が押す物」なので、
            文字で名乗り続ける必要がない。読み上げには aria-label で言葉を残す。
            丸で囲むのは「？」1 文字だとリンクに見えないため */}
        <Link
          href="/docs/search"
          aria-label="検索ヘルプ"
          title="検索ヘルプ"
          className="rounded-full border border-blue-300 px-1.5 text-xs leading-4 text-blue-600"
        >
          ?
        </Link>
        {/* ゴミ箱が空のときは出さない (普段は目に入らないように) */}
        {trashCount > 0 && (
          <Link
            href="/trash"
            transitionTypes={["nav-forward"]}
            aria-label={`ゴミ箱 (${trashCount} 件)`}
            title="ゴミ箱"
            className="inline-flex items-center gap-0.5 self-center text-xs text-blue-600"
          >
            <TrashIcon small />({trashCount})
          </Link>
        )}

        <ResultsToolbar
          query={query}
          sort={sort}
          view={view}
          viewAction={setViewModeAction}
          sortAction={setSortAction}
        />
      </div>

      {/* 件数のすぐ下に進捗。件数 (いま何件出ているか) と進捗 (全体のどこまで
          進んだか) は続けて読む物なので離さない */}
      <TaskProgress done={progress.done} total={progress.total} />

      {/* **送るのはここだけ** (docs/86 §4-6)。検索窓・件数・進捗は動かさず、
          一覧 (と特性表・ページ送り) だけを内側でスクロールさせる。
          スクロールバーもこの器に付くので、一覧の右端に沿う */}
      <div data-results-scroll className="space-y-2">
      <PropsTable
        rows={props.rows}
        omitted={props.omitted}
        query={query}
        sort={sort}
        mathSummaries={mathSummaries}
      />

      <ItemList
        items={result.items}
        query={query}
        page={result.page}
        sort={sort}
        action={bulkTagAction}
        view={view}
        trashAction={trashItemsAction}
        pinAction={setItemsOfflinePinAction}
        registerHref={registerHref}
        trashedMatches={trashedMatches}
        circuitThumbs={circuitThumbs}
        mathTexts={mathTexts}
        notePreviews={notePreviews}
      />

      {/* ページ送りは「前へ/次へ」からオンデマンド表示へ (docs/33)。
          searchItems が 1〜N ページの累積を返すので、末尾の「さらに表示」が
          見えたら次の page へ replace するだけで一覧が伸びる。
          全件出し切ったら何も出さない (件数は先頭に常にある) */}
      {result.page < result.pageCount && (
        <AutoLoadMore
          href={buildSearchUrl(query, result.page + 1, sort)}
          remaining={result.total - result.items.length}
        />
      )}
      </div>
    </SearchResults>
    </>
  );
}
