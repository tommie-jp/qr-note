"use client";

import { type ComponentProps, useState } from "react";
import { PerfMarks } from "@/components/diag/PerfMarks";
import { ItemList } from "@/components/item/ItemList";
import { PropsTable } from "@/components/markdown/PropsTable";
import { AutoLoadMore } from "@/components/search/AutoLoadMore";
import { PlaceholderPages } from "@/components/search/PlaceholderPages";
import { planPlaceholders } from "@/components/search/placeholderPlan";
import { ResultsToolbar } from "@/components/search/ResultsToolbar";
import {
  bulkTagAction,
  setItemsOfflinePinAction,
  setSortAction,
  setViewModeAction,
  trashItemsAction,
  undoTagChangesAction,
} from "@/lib/client/actions";
import type { ListValue } from "@/lib/client/listStore";
import { allViewerMedia } from "@/lib/images/memoImages";
import { useListPlaceholders } from "@/lib/prefs/listPlaceholders";
import type { ViewMode } from "@/lib/prefs/viewMode";
import type { Sort } from "@/lib/validation";

// 検索結果 (SearchResultsClient) の一覧側の表示部品

// 検索結果を読み込めなかった断りと「もう一度」
export function LoadFailedNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
      検索結果を読み込めませんでした: {message}{" "}
      <button type="button" className="underline" onClick={onRetry}>
        もう一度
      </button>
    </p>
  );
}

// 件数の行 (件数・検索ヘルプ・ゴミ箱・表示モードと並び順)
export function ResultsSummaryRow({
  query,
  sort,
  view,
  value,
}: {
  query: string;
  sort: Sort;
  view: ViewMode;
  value: ListValue;
}) {
  const { items, total, extras } = value;
  // スライドショーは画像表示で、画像か動画があるときだけ (docs/117 §1)
  const slideshow = view === "image" && items.some((item) => allViewerMedia(item.memo).length > 0);
  return (
    // 1 行に固定する (折り返さない)。収まらない操作は ResultsToolbar の帯の
    // 中だけ横へ送る (docs/86 §4-33)
    <div className="@container flex items-center gap-2 text-sm text-gray-600">
      {/* shrink-0 … 件数は削らず、詰まったら操作の帯のほうを送らせる。
          max-w-[60%] … 長い検索語のときだけ件数を切る (帯が消えないように) */}
      <span className="min-w-0 max-w-[60%] shrink-0 truncate">
        {query ? `「${query}」の検索結果: ` : "すべて: "}
        {total} 件
      </span>
      <ResultsToolbar
        query={query}
        sort={sort}
        view={view}
        viewAction={setViewModeAction}
        sortAction={setSortAction}
        slideshow={slideshow}
        trashCount={extras.trashCount}
      />
    </div>
  );
}

// 一覧そのもの。操作 (タグ・ゴミ箱・オフラインの印) は端末の action を渡す
function ResultsItemList({
  value,
  query,
  sort,
  view,
  mathTexts,
  notePreviews,
}: {
  value: ListValue;
  query: string;
  sort: Sort;
  view: ViewMode;
  mathTexts: ComponentProps<typeof ItemList>["mathTexts"];
  notePreviews: ComponentProps<typeof ItemList>["notePreviews"];
}) {
  const { items, page, circuitThumbs, extras } = value;
  return (
    <ItemList
      items={items}
      query={query}
      page={page}
      sort={sort}
      action={bulkTagAction}
      undoTagAction={undoTagChangesAction}
      view={view}
      trashAction={trashItemsAction}
      pinAction={setItemsOfflinePinAction}
      registerHref={extras.registerHref}
      trashedMatches={extras.trashedMatches}
      circuitThumbs={circuitThumbs}
      mathTexts={mathTexts}
      notePreviews={notePreviews}
    />
  );
}

// 速度計測の印 (docs/119 §2-1)。検索・続き・表示モードの切替の計測を閉じる。
//
// **印は「出している検索」と「届いた値」の組ごとに作り直す** (親が key で
// 作り直す)。計測は同じ印を二度使わない (perfArrive が時刻で見分ける) ので、
// 値ごとに 1 つだけだと、控えに新しいまま残っている検索や表示モードへ
// 切り替えたとき (取り直さずに即座に描ける) に印が出ず、計測が「未着」で
// 待ちきりになっていた。時刻は作られたときに 1 度だけ決める
function SearchPerf({ fields }: { fields: readonly (readonly [string, string])[] }) {
  const [at] = useState(() => Date.now());
  return <PerfMarks kind="検索" at={at} fields={fields} server="端末" />;
}

type ContinuationProps = Omit<ComponentProps<typeof AutoLoadMore>, "remaining"> & {
  onLoadThrough: (page: number) => void;
  failed: boolean;
  onRetry: () => void;
};

// 一覧の続き。メニューの「一覧の枠」が 0 でなければ空の枠を先に並べ
// (docs/129 §1)、0 なら今までの「さらに表示」だけ
function Continuation({ value, view, loadMore }: { value: ListValue; view: ViewMode; loadMore: ContinuationProps }) {
  const limit = useListPlaceholders();
  const { items, total, page, pageCount } = value;
  const remaining = total - items.length;
  const chunks = planPlaceholders({ loaded: items.length, total, page, pageCount, limit });
  if (chunks.length === 0) {
    return <AutoLoadMore remaining={remaining} {...loadMore} />;
  }
  return (
    <PlaceholderPages
      searchKey={loadMore.searchKey}
      view={view}
      chunks={chunks}
      remaining={remaining}
      onLoadThrough={loadMore.onLoadThrough}
      isPending={loadMore.isPending}
      failed={loadMore.failed}
      onRetry={loadMore.onRetry}
    />
  );
}

// 器の中で送る部分 (特性表・一覧・続き・計測の印)
export function ResultsScrollBody({
  value,
  query,
  sort,
  view,
  mathSummaries,
  mathTexts,
  notePreviews,
  loadMore,
  perf,
}: {
  value: ListValue;
  query: string;
  sort: Sort;
  view: ViewMode;
  mathSummaries: ComponentProps<typeof PropsTable>["mathSummaries"];
  mathTexts: ComponentProps<typeof ItemList>["mathTexts"];
  notePreviews: ComponentProps<typeof ItemList>["notePreviews"];
  loadMore: ContinuationProps;
  // 計測の印。まだ届いていないときは null (出さない)
  perf: { key: string; fields: readonly (readonly [string, string])[] } | null;
}) {
  const { page, pageCount, extras } = value;
  return (
    <div data-results-scroll className="space-y-2">
      <PropsTable
        rows={extras.props.rows}
        omitted={extras.props.omitted}
        query={query}
        sort={sort}
        mathSummaries={mathSummaries}
      />

      <ResultsItemList
        value={value}
        query={query}
        sort={sort}
        view={view}
        mathTexts={mathTexts}
        notePreviews={notePreviews}
      />

      {page < pageCount && (
        <Continuation value={value} view={view} loadMore={loadMore} />
      )}
      {perf !== null && <SearchPerf key={perf.key} fields={perf.fields} />}
    </div>
  );
}
