"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildNotePreviews, warmNotePreviews } from "@/components/item/NotePreviewThumb";
import type { Entry } from "@/lib/client/resourceCache";
import {
  listCache,
  loadMore,
  loadThrough,
  retryLoadMore,
  useLoadMoreFailed,
  useLoadingMore,
  type ListKey,
  type ListValue,
} from "@/lib/client/listStore";
import { startListPersistence } from "@/lib/client/listPersist";
import { useSearchState } from "@/lib/client/useSearchState";
import { warmNotes } from "@/lib/client/warmNotes";
import { perfQuery } from "@/lib/perf/perfLine";
import { buildMathSummaries, buildMathTexts } from "@/lib/markdown/mathText";
import { useShownViewMode } from "@/lib/prefs/pendingViewMode";
import type { ViewMode } from "@/lib/prefs/viewMode";
import type { Sort } from "@/lib/validation";

// 検索結果 (SearchResultsClient) の一覧側が使うフック

interface LastShown {
  value: ListValue;
  query: string;
  sort: Sort;
}

// 新しい鍵の結果がまだ出せない (取り直し中・古い・届いていない)
function isPending(entry: Entry<ListValue> | undefined, fresh: ListValue | undefined): boolean {
  return entry === undefined || entry.loading || entry.stale || (fresh === undefined && !entry.error);
}

// 薄くするのは「出ているのが別の検索の結果」か「書き込みで古くなった結果」の
// ときだけ (docs/123 §11-7・docs/129 §2)。表示モードだけを変えたときは、同じ
// 結果を新しい表示で出し直しているので古くない — 一覧全体の不透明度を変えると、
// スマホでは一覧を丸ごと塗り直す分だけ切替が画面に出るのが遅れた。
//
// **期限切れの確かめ (30 秒) や端末に残した控えの確かめの間は薄くしない。**
// 出しているのはこの検索の結果で、変わっていなければ 304 でそのまま残る
function isDimmed({
  entry,
  pending,
  fresh,
  lastShown,
  query,
  sort,
}: {
  entry: Entry<ListValue> | undefined;
  pending: boolean;
  fresh: ListValue | undefined;
  lastShown: LastShown | undefined;
  query: string;
  sort: Sort;
}): boolean {
  if (fresh !== undefined) {
    return entry?.stale === true;
  }
  return pending && !(lastShown !== undefined && lastShown.query === query && lastShown.sort === sort);
}

// 出す一覧を決める。新しい鍵の結果が届くまでは前に出していた結果を出す
export function useShownResults(cookieSort: Sort, serverView: ViewMode, isDemo: boolean) {
  // 端末に残した一覧の控えを読み戻し、以後は残していく (docs/129 §3)。
  // 下の useEntry の取得より前に始める (effect は書いた順に走る)。デモは
  // 共有アカウントなので残さない
  useEffect(() => {
    if (!isDemo) {
      startListPersistence();
    }
  }, [isDemo]);
  const { query, sort, page: urlPage } = useSearchState(cookieSort);
  const view = useShownViewMode(serverView);
  const key: ListKey = useMemo(() => ({ query, sort, view }), [query, sort, view]);
  // 前の結果があれば、新しい鍵の一覧を取りに行くのは画面に出た後 (docs/123 §11-7)。
  // 表示モードの切替は前の結果を新しい表示ですぐ出せるので、その描画を先に出す
  const entry = listCache.useEntry(key, { afterPaint: true });

  // 前に出していた結果。新しい鍵の結果が届くまではこちらを出す
  // (前の描画の値を state に控える React の作法。ref を描画中に書かない)
  const fresh = entry?.value;
  const [lastShown, setLastShown] = useState<LastShown | undefined>(
    fresh === undefined ? undefined : { value: fresh, query, sort },
  );
  if (fresh !== undefined && fresh !== lastShown?.value) {
    setLastShown({ value: fresh, query, sort });
  }
  const pending = isPending(entry, fresh);
  return {
    query,
    sort,
    urlPage,
    view,
    key,
    entry,
    fresh,
    shown: fresh ?? lastShown?.value,
    pending,
    dimmed: isDimmed({ entry, pending, fresh, lastShown, query, sort }),
  };
}

// 共有された URL の ?page=N。そこまで足す (一度だけ。読み終えたら止まる)
export function useLoadUrlPage(
  fresh: ListValue | undefined,
  urlPage: number,
  key: ListKey,
  loading: boolean | undefined,
) {
  useEffect(() => {
    if (fresh !== undefined && fresh.page < Math.min(urlPage, fresh.pageCount) && !loading) {
      void loadMore(key).catch((error: unknown) => console.warn("続きを読めませんでした", error));
    }
  }, [fresh, urlPage, key, loading]);
}

// タイトル・プレビューの数式 (docs/69) と本文の縮小プレビュー (docs/71)。
// どちらも本文から作れるので端末で作る (サーバ描画の頃は pageData.ts)
// 作り直すのは中身が変わるときだけ (docs/123 §11-7)。数式はカードだけ本文の
// 抜粋も作り、プレビューは画像表示で作らず小・中とカードで文字数が違う。
// 小 ↔ 中の切替で作り直すと、同じ物を作るために一覧の行が全部描き直される
export function useResultPreviews(value: ListValue, view: ViewMode) {
  const { items, circuitThumbs, extras } = value;
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
  return { mathTexts, mathSummaries, notePreviews };
}

// **読み込み関数は表示モードで作り直さない** (docs/123 §11-7)。作り直すと
// AutoLoadMore が番兵の監視を張り直し、描画の直後に一覧の高さを読む (レイアウトを
// 強制する)。表示モードの切替が画面に出るまでの間に重いレイアウトが 1 回挟まり、
// iPhone で切替の即時が延びていた。いまの鍵は ref から読む
export function useLoadMoreHandlers(listKey: ListKey) {
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
  // 枠の塊が画面に入ったら、そのページまで (docs/129 §1)
  const onLoadThrough = useCallback((page: number) => {
    void loadThrough(listKeyRef.current, page).catch((error: unknown) =>
      console.warn("続きを読めませんでした", error),
    );
  }, []);
  // ResultsScrollBody の loadMore にそのまま渡せる形
  return {
    onLoad: onLoadMore,
    onLoadThrough,
    isPending: loadingMore,
    failed: loadMoreFailed,
    onRetry: onRetryMore,
  };
}

// 欄の並びはサーバ描画の頃と同じ (q・panes・view・件数)。ベンチマークの
// 要約 (diag/clientBenchHarvest.ts) は q の欄で検索の行を拾う
export function useSearchPerfFields(
  query: string,
  mode: string,
  view: ViewMode,
  count: number,
  total: number,
) {
  return useMemo(
    () =>
      [
        ["q", perfQuery(query)],
        ["panes", mode],
        ["view", view],
        ["件数", `${count}/${total}`],
      ] as const,
    [query, mode, view, count, total],
  );
}
