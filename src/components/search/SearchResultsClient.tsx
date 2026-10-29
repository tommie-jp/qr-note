"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BusyNotice } from "@/components/chrome/BusyNotice";
import { PerfMarks } from "@/components/diag/PerfMarks";
import { TrashIcon } from "@/components/icons";
import { ItemList } from "@/components/item/ItemList";
import { buildNotePreviews, warmNotePreviews } from "@/components/item/NotePreviewThumb";
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
import { perfQuery } from "@/lib/logging/perfLine";
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
  // 前の結果があれば、新しい鍵の一覧を取りに行くのは画面に出た後 (docs/123 §11-7)。
  // 表示モードの切替は前の結果を新しい表示ですぐ出せるので、その描画を先に出す
  const entry = listCache.useEntry(key, { afterPaint: true });

  // 前に出していた結果。新しい鍵の結果が届くまではこちらを出す
  // (前の描画の値を state に控える React の作法。ref を描画中に書かない)
  const fresh = entry?.value;
  const [lastShown, setLastShown] = useState<{ value: ListValue; query: string; sort: Sort } | undefined>(
    fresh === undefined ? undefined : { value: fresh, query, sort },
  );
  if (fresh !== undefined && fresh !== lastShown?.value) {
    setLastShown({ value: fresh, query, sort });
  }
  const shown = fresh ?? lastShown?.value;
  const pending =
    entry === undefined || entry.loading || entry.stale || (fresh === undefined && !entry.error);
  // 薄くするのは「出ているのが別の検索の結果」のときだけ (docs/123 §11-7)。
  // 表示モードだけを変えたときは、同じ結果を新しい表示で出し直しているので
  // 古くない — 一覧全体の不透明度を変えると、スマホでは一覧を丸ごと塗り直す
  // 分だけ切替が画面に出るのが遅れた (サーバ描画の頃の切替も薄くしなかった)
  const dimmed =
    pending &&
    !(fresh === undefined && lastShown !== undefined && lastShown.query === query && lastShown.sort === sort);

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
}: {
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
}) {
  const { items, total, page, pageCount, circuitThumbs, extras } = value;
  const { mode } = usePaneMode();

  // タイトル・プレビューの数式 (docs/69) と本文の縮小プレビュー (docs/71)。
  // どちらも本文から作れるので端末で作る (サーバ描画の頃は pageData.ts)
  // 作り直すのは中身が変わるときだけ (docs/123 §11-7)。数式はカードだけ本文の
  // 抜粋も作り、プレビューは画像表示で作らず小・中とカードで文字数が違う。
  // 小 ↔ 中の切替で作り直すと、同じ物を作るために一覧の行が全部描き直される
  const mathMode = view === "card" ? "both" : "title";
  const previewView: ViewMode = view === "card" || view === "image" ? view : "compact";
  const mathTexts = useMemo(() => buildMathTexts(items, mathMode), [items, mathMode]);
  const mathSummaries = useMemo(
    () => buildMathSummaries(extras.props.rows, mathTexts),
    [extras.props.rows, mathTexts],
  );
  const notePreviews = useMemo(
    () => buildNotePreviews(items, circuitThumbs, previewView),
    [items, circuitThumbs, previewView],
  );

  // 開く前に本文を解析しておく (docs/123 §11-4)。一覧が入れ替わったら前の分は止める
  // 一覧のプレビューは表示モードごとに解析が要るので、それも先に (§11-7)
  useEffect(
    () => warmNotes(items.map((item) => item.memo), warmNotePreviews(items, circuitThumbs)),
    [items, circuitThumbs],
  );

  // ノートのペインを持つ構成では、何も選んでいないとき先頭を出す (docs/86 §4-4)
  const first = showsAutoNote(mode) ? items[0] : undefined;
  // スライドショーは画像表示で、画像か動画があるときだけ (docs/117 §1)
  const slideshow = view === "image" && items.some((item) => allViewerMedia(item.memo).length > 0);

  const searchKey = listKeyOf({ ...listKey, view: "compact" });
  // **読み込み関数は表示モードで作り直さない** (docs/123 §11-7)。作り直すと
  // AutoLoadMore が番兵の監視を張り直し、描画の直後に一覧の高さを読む (レイアウトを
  // 強制する)。表示モードの切替が画面に出るまでの間に重いレイアウトが 1 回挟まり、
  // iPhone で切替の即時が延びていた。いまの鍵は ref から読む
  const listKeyRef = useRef(listKey);
  useEffect(() => {
    listKeyRef.current = listKey;
  }, [listKey]);
  const onLoadMore = useCallback(() => {
    void loadMore(listKeyRef.current).catch((error: unknown) =>
      console.warn("続きを読めませんでした", error),
    );
  }, []);
  const loadingMore = useLoadingMore(listKey);
  const loadMoreFailed = useLoadMoreFailed(listKey);
  const onRetryMore = useCallback(() => {
    void retryLoadMore(listKeyRef.current).catch((error: unknown) =>
      console.warn("続きを読めませんでした", error),
    );
  }, []);

  // 欄の並びはサーバ描画の頃と同じ (q・panes・view・件数)。ベンチマークの
  // 要約 (diag/clientBenchHarvest.ts) は q の欄で検索の行を拾う
  const perfFields = useMemo(
    () =>
      [
        ["q", perfQuery(query)],
        ["panes", mode],
        ["view", view],
        ["件数", `${items.length}/${total}`],
      ] as const,
    [query, mode, view, items.length, total],
  );
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
          {!pending && <SearchPerf key={perfKey} fields={perfFields} />}
        </div>
      </SearchResults>
    </>
  );
});
