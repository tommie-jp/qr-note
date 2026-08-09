"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BOX_CLASS, BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "@/components/ui";
import { offlineCircuitMap } from "@/lib/offline/circuits";
import { loadOfflineSnapshot } from "@/lib/offline/db";
import { buildOfflineIndex, filterOfflineItems } from "@/lib/offline/filter";
import type { OfflineSyncPayload } from "@/lib/offline/item";
import {
  locationSearch,
  notifyLocationChanged,
  readSortCookie,
  serverLocationSearch,
  serverSortCookie,
  subscribeLocation,
  subscribeNever,
} from "@/lib/offline/location";
import { sortOfflineItems } from "@/lib/offline/order";
import { offlineRouteUrl, readOfflineRoute, type OfflineRoute } from "@/lib/offline/params";
import {
  requestPersistentStorage,
  storageUsage,
  syncPinnedAssets,
  type PinProgress,
} from "@/lib/offline/pinCache";
import { LAST_SYNC_ATTEMPT_KEY, writeMark } from "@/lib/offline/schedule";
import { prefetchOfflineThumbs, syncOfflineItems, type PrefetchProgress } from "@/lib/offline/sync";
import { OfflineList } from "./OfflineList";
import { OfflineNote } from "./OfflineNote";
import { OfflineStatus } from "./OfflineStatus";

// オフラインの検索・閲覧画面 (docs/65-オフライン対応計画.md §3-4)。
//
// ## この画面が守っている 3 つの制約
//
// 1. **ネットワークを一切前提にしない。** ノートは IndexedDB から読む。
//    サーバへ行くのは、利用者がボタンを押したときだけ。
// 2. **別ルートへ遷移しない。** App Router の画面遷移は RSC ペイロードを
//    取りに行くので圏外では必ず失敗する。開くのも戻るのも、この 1 ページの
//    中で state を切り替え、URL は history の API で追随させる (params.ts)。
// 3. **描画は URL を直接読まない。** この HTML は Service Worker が殻として
//    保存した 1 枚きりで、?item=4518 で開かれても中身は同じ。URL はマウント
//    後に読む (サーバ描画と食い違わせない)。
//
// URL と並び順 (cookie) は React の state ではなく外部ストアとして購読する。
// 理由と仕組みは location.ts の冒頭に書いた。

export function OfflineApp() {
  // URL が正本。戻る/進むも打鍵もここへ集まる (location.ts)
  const search = useSyncExternalStore(subscribeLocation, locationSearch, serverLocationSearch);
  const route = useMemo(() => readOfflineRoute(search), [search]);
  const sort = useSyncExternalStore(subscribeNever, readSortCookie, serverSortCookie);

  const [snapshot, setSnapshot] = useState<OfflineSyncPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [prefetch, setPrefetch] = useState<PrefetchProgress | null>(null);
  const [pinProgress, setPinProgress] = useState<PinProgress | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const report = useCallback((text: string | null, failed = false) => {
    setMessage(text);
    setIsError(failed);
  }, []);

  // 保存済みのノートを読む。IndexedDB は非同期なので、ここだけは効果で受ける
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await loadOfflineSnapshot();
        if (!cancelled) {
          setSnapshot(stored);
        }
      } catch (error) {
        // IndexedDB は iOS で不安定 (docs/65-オフライン対応計画.md §5-6)。読めないことは「保存が無い」と
        // 同じ扱いにするが、原因は残す — 直す手立ては再同期しかない
        console.warn("OfflineApp: 保存したノートを読めませんでした", error);
        if (!cancelled) {
          report("保存したノートを読み込めませんでした。同期し直してください", true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [report]);

  // 端末が使っている容量。**表示のためだけ**なので、読めなくても黙って諦める
  // (storageUsage が null を返す。pinCache.ts)
  useEffect(() => {
    void storageUsage().then(setUsage);
  }, []);

  // URL を書き換えて画面を切り替える。**どちらの API も通信を起こさない**
  // (Next.js は router の state に取り込むだけ。RSC は取りに行かない)。
  //
  // 打鍵は replace、ノートを開くのは push。打つたびに履歴を積むと、
  // 「戻る」を検索語の文字数だけ押さないと前の画面へ帰れなくなる。
  //
  // notifyLocationChanged … history API は自分で書き換えたときに popstate を
  // 出さないので、購読側へは自分で知らせる (location.ts の約束)
  const navigate = useCallback((next: OfflineRoute, replace = false) => {
    const url = offlineRouteUrl(next);
    if (replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
    notifyLocationChanged();
  }, []);

  // 正規化 (NFKC) は打鍵のたびに全件へ掛かるので、索引は 1 度だけ作る
  const index = useMemo(() => buildOfflineIndex(snapshot?.items ?? []), [snapshot]);
  const results = useMemo(
    () => sortOfflineItems(filterOfflineItems(index, route.query), sort),
    [index, route.query, sort],
  );
  const circuits = useMemo(
    () => offlineCircuitMap(snapshot?.circuits ?? []),
    [snapshot],
  );
  const pinnedCount = useMemo(
    () => (snapshot?.items ?? []).filter((item) => item.pinned).length,
    [snapshot],
  );
  const openItem = useMemo(
    () =>
      route.itemNo === null
        ? null
        : (snapshot?.items.find((item) => item.itemNo === route.itemNo) ?? null),
    [snapshot, route.itemNo],
  );

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    report("同期しています…");
    // 手で撃った同期も自動同期の間隔に数える。押した直後に画面を開き直して
    // もう一度落とすのは無駄 (schedule.ts)
    writeMark(LAST_SYNC_ATTEMPT_KEY, String(Date.now()));
    try {
      const payload = await syncOfflineItems();
      setSnapshot(payload);
      report(`${payload.items.length} 件を保存しました`);
    } catch (error) {
      report(error instanceof Error ? error.message : "同期に失敗しました", true);
    } finally {
      setIsSyncing(false);
    }
  }, [report]);

  const handlePrefetch = useCallback(async () => {
    report("画像を保存しています…");
    try {
      const failed = await prefetchOfflineThumbs(snapshot?.items ?? [], setPrefetch);
      report(
        failed === 0
          ? "画像を保存しました"
          : `画像を保存しました（${failed} 件は取得できませんでした）`,
        failed > 0,
      );
    } catch (error) {
      report(error instanceof Error ? error.message : "画像を保存できませんでした", true);
    } finally {
      setPrefetch(null);
    }
  }, [snapshot, report]);

  // 印付きノートの持ち出しを揃える (docs/65-オフライン対応計画.md §10)。
  //
  // 印を付けたのは利用者なので**自動でも走る** (OfflineSync)。ここに手で撃つ
  // 口も置くのは、圏外で落とし損ねた分を電波の戻った場で自分で埋められる
  // ようにするため — 自動は 5 分間隔で、待てないときがある
  const handlePinSync = useCallback(async () => {
    report("オフライン保存を揃えています…");
    // 永続化の申し入れは**押されたときだけ**にする (docs/65-オフライン対応計画.md §10)。
    // Firefox は persist() で確認バーを出すので、画面を開いた副作用として撃つと
    // 「何もしていないのに許可を求められた」になる。ここは利用者が押した直後で、
    // しかも真下に保存量が出ている場面なので、聞くなら筋が通る
    await requestPersistentStorage();
    try {
      const result = await syncPinnedAssets(snapshot?.items ?? [], setPinProgress);
      report(
        result.failed === 0
          ? `${result.notes} 件のノート（${result.files} ファイル）を保存しました`
          : `${result.files} ファイル中 ${result.failed} 件を取得できませんでした`,
        result.failed > 0,
      );
      // 揃えた直後は容量が動いている。押した人が結果を見たい場面なので
      // 出し直す (押していないときに定期的に測りに行くほどの値ではない)
      setUsage(await storageUsage());
    } catch (error) {
      report(error instanceof Error ? error.message : "オフライン保存に失敗しました", true);
    } finally {
      setPinProgress(null);
    }
  }, [snapshot, report]);

  // 同期の導線は一覧からも「見つからない」からも押せるべきなので、要素を
  // 1 つ作って両方に置く (中でコンポーネントを定義すると毎描画で作り直しになる)
  const statusBar = (
    <OfflineStatus
      syncedAt={snapshot?.syncedAt ?? null}
      count={snapshot?.items.length ?? 0}
      truncated={snapshot?.truncated ?? false}
      circuitsOmitted={snapshot?.circuitsOmitted ?? 0}
      pinnedCount={pinnedCount}
      isSyncing={isSyncing}
      prefetch={prefetch}
      pinProgress={pinProgress}
      usage={usage}
      message={message}
      isError={isError}
      onSync={() => void handleSync()}
      onPrefetch={() => void handlePrefetch()}
      onPinSync={() => void handlePinSync()}
    />
  );

  if (isLoading) {
    return (
      <p role="status" className={`${BUSY_NOTICE_CLASS} flex items-center gap-2`}>
        <span aria-hidden className={BUSY_SPINNER_CLASS} />
        保存したノートを読み込み中…
      </p>
    );
  }

  if (openItem !== null) {
    return (
      <OfflineNote
        item={openItem}
        circuits={circuits}
        onBack={() => navigate({ query: route.query, itemNo: null })}
      />
    );
  }

  return (
    <div className="space-y-2">
      {statusBar}

      {/* 開こうとしたノートが手元に無い (同期より後に作られた / 上限で切られた)。
          黙って一覧を出すと「検索しても出てこない」に化けるので、名指しで断る */}
      {route.itemNo !== null && (
        <p className={BOX_CLASS}>
          <span className="font-mono">#{route.itemNo}</span>{" "}
          はオフライン用に保存されていません。電波の届く場所で同期してください。
        </p>
      )}

      <input
        type="search"
        value={route.query}
        onChange={(event) => navigate({ query: event.target.value, itemNo: null }, true)}
        placeholder="オフライン検索 (#タグ・is:todo も使えます)"
        // enterKeyHint … 打つそばから絞り込むので Enter で確定する操作が無い。
        // 「検索」ではなく「完了」を出してキーボードを閉じさせる
        enterKeyHint="done"
        className={`w-full ${BOX_CLASS}`}
      />

      <p className="text-sm text-gray-600">
        {route.query ? `「${route.query}」の検索結果: ` : "すべて: "}
        {results.length} 件
      </p>

      <OfflineList items={results} onOpen={(itemNo) => navigate({ ...route, itemNo })} />
    </div>
  );
}
