"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BusyNotice } from "@/components/chrome/BusyNotice";
import { PerfMarks } from "@/components/diag/PerfMarks";
import { TrashIcon } from "@/components/icons";
import { ItemList } from "@/components/item/ItemList";
import { buildNotePreviews } from "@/components/item/NotePreviewThumb";
import { NoteNav } from "@/components/item/NoteNav";
import { NoteView } from "@/components/item/NoteView";
import { PropsTable } from "@/components/markdown/PropsTable";
import { TaskProgress } from "@/components/markdown/TaskProgress";
import { AutoNotePane } from "@/components/notepage/AutoNotePane";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { AutoLoadMore } from "@/components/search/AutoLoadMore";
import { ResultsToolbar } from "@/components/search/ResultsToolbar";
import { SearchResults } from "@/components/search/SearchNav";
import {
  bulkTagAction,
  setItemsOfflinePinAction,
  setSortAction,
  setViewModeAction,
  trashItemsAction,
} from "@/lib/client/actions";
import {
  listCache,
  listKeyOf,
  loadMore,
  retryLoadMore,
  useLoadMoreFailed,
  useLoadingMore,
  type ListKey,
  type ListValue,
} from "@/lib/client/listStore";
import { useSearchState } from "@/lib/client/useSearchState";
import { warmNotes } from "@/lib/client/warmNotes";
import { allViewerMedia } from "@/lib/images/memoImages";
import { buildMathSummaries, buildMathTexts } from "@/lib/markdown/mathText";
import { useShownViewMode } from "@/lib/prefs/pendingViewMode";
import { showsAutoNote } from "@/lib/prefs/paneMode";
import type { ViewMode } from "@/lib/prefs/viewMode";
import { buildItemUrl } from "@/lib/search/url";
import type { Sort } from "@/lib/validation";

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
export function SearchResultsClient({
  cookieSort,
  serverView,
  paneBgClass,
  isDemo,
}: SearchResultsClientProps) {
  const { query, sort, page: urlPage } = useSearchState(cookieSort);
  const view = useShownViewMode(serverView);
  const key: ListKey = useMemo(() => ({ query, sort, view }), [query, sort, view]);
  const entry = listCache.useEntry(key);

  // 前に出していた結果。新しい鍵の結果が届くまではこちらを出す
  // (前の描画の値を state に控える React の作法。ref を描画中に書かない)
  const fresh = entry?.value;
  const [lastShown, setLastShown] = useState<ListValue | undefined>(fresh);
  if (fresh !== undefined && fresh !== lastShown) {
    setLastShown(fresh);
  }
  const shown = fresh ?? lastShown;
  const pending =
    entry === undefined || entry.loading || entry.stale || (fresh === undefined && !entry.error);

  // 共有された URL の ?page=N。そこまで足す (一度だけ。読み終えたら止まる)
  useEffect(() => {
    if (fresh !== undefined && fresh.page < Math.min(urlPage, fresh.pageCount) && !entry?.loading) {
      void loadMore(key).catch((error: unknown) => console.warn("続きを読めませんでした", error));
    }
  }, [fresh, urlPage, key, entry?.loading]);

  if (shown === undefined) {
    return entry?.error ? (
      <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
        検索結果を読み込めませんでした: {entry.error.message}{" "}
        <button type="button" className="underline" onClick={() => listCache.load(key, { force: true })}>
          もう一度
        </button>
      </p>
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
      <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
        検索結果を読み込めませんでした: {entry.error.message}{" "}
        <button type="button" className="underline" onClick={() => listCache.load(key, { force: true })}>
          もう一度
        </button>
      </p>
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
      paneBgClass={paneBgClass}
      isDemo={isDemo}
    />
    </>
  );
}

// 値 (控えの 1 項目) ごとに 1 回だけ印を出すための時刻
const arrivedAt = new WeakMap<ListValue, number>();

function arrivalOf(value: ListValue): number {
  const known = arrivedAt.get(value);
  if (known !== undefined) {
    return known;
  }
  const at = Date.now();
  arrivedAt.set(value, at);
  return at;
}

function LoadedResults({
  listKey,
  value,
  query,
  sort,
  view,
  pending,
  paneBgClass,
  isDemo,
}: {
  listKey: ListKey;
  value: ListValue;
  query: string;
  sort: Sort;
  view: ViewMode;
  pending: boolean;
  paneBgClass: string;
  isDemo: boolean;
}) {
  const { items, total, page, pageCount, circuitThumbs, extras } = value;
  const { mode } = usePaneMode();

  // タイトル・プレビューの数式 (docs/69) と本文の縮小プレビュー (docs/71)。
  // どちらも本文から作れるので端末で作る (サーバ描画の頃は pageData.ts)
  const mathTexts = useMemo(
    () => buildMathTexts(items, view === "card" ? "both" : "title"),
    [items, view],
  );
  const mathSummaries = useMemo(
    () => buildMathSummaries(extras.props.rows, mathTexts),
    [extras.props.rows, mathTexts],
  );
  const notePreviews = useMemo(
    () => buildNotePreviews(items, circuitThumbs, view),
    [items, circuitThumbs, view],
  );

  // 開く前に本文を解析しておく (docs/123 §11-4)。一覧が入れ替わったら前の分は止める
  useEffect(() => warmNotes(items.map((item) => item.memo)), [items]);

  // ノートのペインを持つ構成では、何も選んでいないとき先頭を出す (docs/86 §4-4)
  const first = showsAutoNote(mode) ? items[0] : undefined;
  // スライドショーは画像表示で、画像か動画があるときだけ (docs/117 §1)
  const slideshow = view === "image" && items.some((item) => allViewerMedia(item.memo).length > 0);

  const searchKey = listKeyOf({ ...listKey, view: "compact" });
  const onLoadMore = useCallback(() => {
    void loadMore(listKey).catch((error: unknown) => console.warn("続きを読めませんでした", error));
  }, [listKey]);
  const loadingMore = useLoadingMore(listKey);
  const loadMoreFailed = useLoadMoreFailed(listKey);
  const onRetryMore = useCallback(() => {
    void retryLoadMore(listKey).catch((error: unknown) => console.warn("続きを読めませんでした", error));
  }, [listKey]);

  const at = arrivalOf(value);
  const perfFields = useMemo(
    () =>
      [
        ["件数", `${items.length}/${total}`],
        ["view", view],
      ] as const,
    [items.length, total, view],
  );

  return (
    <>
      {first ? (
        <AutoNotePane
          key={first.itemId}
          bgClass={paneBgClass}
          itemId={first.itemId}
          openHref={buildItemUrl(first.itemId, query, sort)}
        >
          <NoteView itemId={first.itemId} isDemo={isDemo} shell="auto" />
          <NoteNav itemId={first.itemId} query={query} sort={sort} />
        </AutoNotePane>
      ) : null}
      <SearchResults query={query} pending={pending}>
        <div className="@container flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span className="min-w-0 flex-1 truncate">
            {query ? `「${query}」の検索結果: ` : "すべて: "}
            {total} 件
          </span>
          <Link
            href="/docs/search"
            aria-label="検索ヘルプ"
            title="検索ヘルプ"
            className="rounded-full border border-blue-300 px-1.5 text-xs leading-4 text-blue-600"
          >
            ?
          </Link>
          {extras.trashCount > 0 && (
            <Link
              href="/trash"
              transitionTypes={["nav-forward"]}
              aria-label={`ゴミ箱 (${extras.trashCount} 件)`}
              title="ゴミ箱"
              className="inline-flex items-center gap-0.5 self-center text-xs text-blue-600"
            >
              <TrashIcon small />({extras.trashCount})
            </Link>
          )}
          <ResultsToolbar
            query={query}
            sort={sort}
            view={view}
            viewAction={setViewModeAction}
            sortAction={setSortAction}
            slideshow={slideshow}
          />
        </div>

        <TaskProgress done={extras.progress.done} total={extras.progress.total} />

        <div data-results-scroll className="space-y-2">
          <PropsTable
            rows={extras.props.rows}
            omitted={extras.props.omitted}
            query={query}
            sort={sort}
            mathSummaries={mathSummaries}
          />

          <ItemList
            items={items}
            query={query}
            page={page}
            sort={sort}
            action={bulkTagAction}
            view={view}
            trashAction={trashItemsAction}
            pinAction={setItemsOfflinePinAction}
            registerHref={extras.registerHref}
            trashedMatches={extras.trashedMatches}
            circuitThumbs={circuitThumbs}
            mathTexts={mathTexts}
            notePreviews={notePreviews}
          />

          {page < pageCount && (
            <AutoLoadMore
              searchKey={searchKey}
              remaining={total - items.length}
              onLoad={onLoadMore}
              isPending={loadingMore}
              failed={loadMoreFailed}
              onRetry={onRetryMore}
            />
          )}
          {!pending && <PerfMarks kind="検索" at={at} fields={perfFields} server="端末" />}
        </div>
      </SearchResults>
    </>
  );
}
