"use client";

import { memo } from "react";
import { BusyNotice } from "@/components/chrome/BusyNotice";
import { NoteNav } from "@/components/item/NoteNav";
import { NoteView } from "@/components/item/NoteView";
import { TaskProgress } from "@/components/markdown/TaskProgress";
import { AutoNotePane } from "@/components/notepage/AutoNotePane";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { SearchResults } from "@/components/search/SearchNav";
import { listCache, listKeyOf, type ListKey, type ListValue } from "@/lib/client/listStore";
import { useSearchState } from "@/lib/client/useSearchState";
import { showsAutoNote } from "@/lib/prefs/paneMode";
import type { ViewMode } from "@/lib/prefs/viewMode";
import { buildItemUrl } from "@/lib/search/url";
import { useSearchParams } from "next/navigation";
import { activeResultView, type ResultView } from "@/modules/registry";
import { PaneResizer } from "@/components/panes/PaneResizer";
import type { Sort } from "@/lib/validation";
import {
  LoadFailedNotice,
  ResultsScrollBody,
  ResultsSummaryRow,
} from "./SearchResultsParts";
import {
  useLoadMoreHandlers,
  useLoadUrlPage,
  useResultPreviews,
  useSearchPerfFields,
  useShownResults,
} from "./useListResults";

interface SearchResultsClientProps {
  // サーバが cookie から読んだ値。URL や端末の切替が優先する
  cookieSort: Sort;
  serverView: ViewMode;
  // 自動ノートのペインの地色 (本番=灰 / ローカル=ピンク。env はサーバで読む)
  paneBgClass: string;
  isDemo: boolean;
}

// 検索結果 (docs/123 §4-2)。もとはサーバ描画の (search)/HomeResults.tsx で、
// 組み立て (件数の行・特性表・一覧・続き) はそのまま写した。
//
// 材料は GET /api/items から控え (listStore) に入る。一覧のプレビューと数式は
// 本文から端末で作る (サーバは HTML を作らない)。
//
// **取り直しの間は前の結果を出したまま薄くする** — 打鍵ごとに白くならない
// (App Router がサーバ描画の頃にしていたことを、控えで同じようにする)
export function SearchResultsClient(props: SearchResultsClientProps) {
  // URL がモジュールの表示 (カレンダーなど。docs/126 §1-3) を選んでいれば、
  // 一覧の代わりにそちらを出す。一覧の控えは引かない
  const resultView = activeResultView(useSearchParams());
  if (resultView !== null) {
    return <ModuleResults view={resultView} cookieSort={props.cookieSort} />;
  }
  return <ListResults {...props} />;
}

// モジュールの表示。検索窓・件数の器 (SearchResults) は一覧と共有し、
// 中身だけを差し替える。器は画面の左右の余白まで広げ (-mx-safe)、同じ幅の
// padding で中身を戻す — 表示が余白へはみ出せるように (カレンダーの余白の
// 設定。docs/126 §1-19)。2・3 ペインではこの器が縦に送るので横を切る
function ModuleResults({ view, cookieSort }: { view: ResultView; cookieSort: Sort }) {
  const { query } = useSearchState(cookieSort);
  const Component = view.Component;
  return (
    <SearchResults query={query}>
      {/* data-results-view … 表示を出している間は 1 ペインでも器の中で送る (globals.css。
          見出しを上端に貼り付けるため。docs/126 §1-28) */}
      <div data-results-scroll data-results-view="" className="-mx-safe space-y-2 px-safe">
        <Component query={query} previewResizer={<PaneResizer kind="preview" />} />
      </div>
    </SearchResults>
  );
}

function ListResults({
  cookieSort,
  serverView,
  paneBgClass,
  isDemo,
}: SearchResultsClientProps) {
  const { query, sort, urlPage, view, key, entry, fresh, shown, pending, dimmed } =
    useShownResults(cookieSort, serverView);

  useLoadUrlPage(fresh, urlPage, key, entry?.loading);

  const retry = () => listCache.load(key, { force: true });
  if (shown === undefined) {
    return entry?.error ? (
      <LoadFailedNotice message={entry.error.message} onRetry={retry} />
    ) : (
      <BusyNotice role="status" busy>
        検索結果を読み込み中…
      </BusyNotice>
    );
  }

  // 新しい検索が失敗した。前の結果を出したままにすると、違う検索語の下に
  // 古い結果が薄く残り続ける。断りと「もう一度」を上に出す
  const failedNotice =
    fresh === undefined && entry?.error ? (
      <LoadFailedNotice message={entry.error.message} onRetry={retry} />
    ) : null;

  return (
    <>
    {failedNotice}
    <LoadedResults
      listKey={key}
      value={shown}
      query={query}
      sort={sort}
      view={view}
      pending={pending}
      dimmed={dimmed}
      paneBgClass={paneBgClass}
      isDemo={isDemo}
    />
    </>
  );
}

// 2・3 ペインで何も選んでいないときに出す先頭のノート (docs/86 §4-4)。
//
// **表示モードを切り替えても描き直さない** (docs/123 §11-7)。一覧の描き直し
// (表示モード・続き・取り直し) のたびにノート 1 枚を丸ごと描き直していて、
// iPhone では表示の切替が画面に出るまでが 50ms → 240ms に延びた。サーバ描画の
// 頃はこのノートが RSC で、端末の切替の対象外だった。受け取るのは文字列と
// 真偽だけなので、同じノート・同じ検索なら memo が描き直しを飛ばす
const AutoNote = memo(function AutoNote({
  itemId,
  query,
  sort,
  paneBgClass,
  isDemo,
}: {
  itemId: string;
  query: string;
  sort: Sort;
  paneBgClass: string;
  isDemo: boolean;
}) {
  return (
    <AutoNotePane bgClass={paneBgClass} itemId={itemId} openHref={buildItemUrl(itemId, query, sort)}>
      <NoteView itemId={itemId} isDemo={isDemo} shell="auto" />
      <NoteNav itemId={itemId} query={query} sort={sort} />
    </AutoNotePane>
  );
});

// 値 (控えの 1 項目) ごとの通し番号。印を作り直す key に使う
const valueIds = new WeakMap<ListValue, number>();
let nextValueId = 0;

function valueIdOf(value: ListValue): number {
  const known = valueIds.get(value);
  if (known !== undefined) {
    return known;
  }
  nextValueId += 1;
  valueIds.set(value, nextValueId);
  return nextValueId;
}

interface LoadedResultsProps {
  listKey: ListKey;
  value: ListValue;
  query: string;
  sort: Sort;
  view: ViewMode;
  // まだ届いていない (計測の印を出さない)
  pending: boolean;
  // 別の検索の結果を出している (薄くする)
  dimmed: boolean;
  paneBgClass: string;
  isDemo: boolean;
}

// **値と状態が変わらなければ描き直さない** (docs/123 §11-7)。表示モードを
// 切り替えると、新しい表示モードの一覧を取りに行き始めた知らせ (控えの
// 「読み込み中」) でもう 1 度描き直しが起き、中身が同じ一覧 20 行を丸ごと
// 描き直していた (iPhone で切替が画面に出るまでが延びた原因の 1 つ)
const LoadedResults = memo(function LoadedResults({
  listKey,
  value,
  query,
  sort,
  view,
  pending,
  dimmed,
  paneBgClass,
  isDemo,
}: LoadedResultsProps) {
  const { items, total, extras } = value;
  const { mode } = usePaneMode();
  const { mathTexts, mathSummaries, notePreviews } = useResultPreviews(value, view);

  // ノートのペインを持つ構成では、何も選んでいないとき先頭を出す (docs/86 §4-4)
  const first = showsAutoNote(mode) ? items[0] : undefined;

  const searchKey = listKeyOf({ ...listKey, view: "compact" });
  const { onLoadMore, loadingMore, loadMoreFailed, onRetryMore } = useLoadMoreHandlers(listKey);
  const perfFields = useSearchPerfFields(query, mode, view, items.length, total);
  const perfKey = `${listKeyOf(listKey)}\u0000${valueIdOf(value)}`;

  return (
    <>
      {first ? (
        <AutoNote
          key={first.itemId}
          itemId={first.itemId}
          query={query}
          sort={sort}
          paneBgClass={paneBgClass}
          isDemo={isDemo}
        />
      ) : null}
      <SearchResults query={query} pending={dimmed}>
        <ResultsSummaryRow query={query} sort={sort} view={view} value={value} />

        <TaskProgress done={extras.progress.done} total={extras.progress.total} />

        <ResultsScrollBody
          value={value}
          query={query}
          sort={sort}
          view={view}
          mathSummaries={mathSummaries}
          mathTexts={mathTexts}
          notePreviews={notePreviews}
          loadMore={{ searchKey, onLoad: onLoadMore, isPending: loadingMore, failed: loadMoreFailed, onRetry: onRetryMore }}
          perf={pending ? null : { key: perfKey, fields: perfFields }}
        />
      </SearchResults>
    </>
  );
});
