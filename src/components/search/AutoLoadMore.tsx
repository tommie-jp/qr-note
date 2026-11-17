"use client";

import { useCallback, useEffect, useRef } from "react";
import { COMPACT_ACTION_LINK_CLASS } from "@/components/ui";
import { perfStart } from "@/lib/perf/perfClient";
import { afterNextPaint } from "@/lib/afterNextPaint";
import { LOAD_MORE_EVENT } from "./loadMore";
import { shouldObserveLoadMore } from "./loadMoreGate";
import { useCoveredByNote, useScrollArmed } from "./useScrollArmed";
import { isListScrollable, scrollRootOf, useFitsInScroller } from "./useFitsInScroller";

// 検索一覧の末尾に置く「さらに表示」(docs/33-オンデマンド表示計画.md §3)。
// 画面に入ったら自動で次ページの URL へ replace し、サーバが 1〜N ページの
// 累積を返して一覧が伸びる。読み込み済みリストをクライアントに蓄積しない
// (URL が正・docs/11 §3)。リンクとしても押せるのは observer が効かない
// 環境へのフォールバックと、「残り n 件」を見せる表示を兼ねるため。
//
// replace であって push ではない … ページ送りは「同じ検索を続きまで見る」
// 操作で、戻るで 1 ページずつ縮んでほしくはない (SearchNav の打鍵と同じ扱い)。
// scroll={false} … 同一ページの searchParams 遷移では Next が位置を保つが、
// 明示して意図を残す。
//
// 発火が二重になっても replace 先は同じ URL なので害はないが、
// isPending 中は観測を止めて無駄撃ちを避ける。
//
// **検索の直後は、利用者が一覧を下へスクロールするまで観測しない**
// (docs/118 §2、判定は loadMoreGate.ts)。20 件では先読みの距離が埋まらず、
// 誰も読み進めていないのに追加が 1〜2 回続いていた。ただし一覧が器より
// 短い (スクロールできない) 間は今までどおり自動で埋める — 画面の高い PC で
// 永久に伸びなくなるため。埋まったら、そこからはスクロールを待つ。
// 収まっているかは一度きりでなく、大きさが変わるたびに測り直す
// (useFitsInScroller。表示モードの切替やウィンドウの拡大で後から収まる。docs/118 §2-6)
// 先読みの距離。root の高さに対する割合 (1 画面ぶん)
export const PREFETCH_MARGIN = "100% 0px";

export function AutoLoadMore({
  searchKey,
  remaining,
  onLoad,
  isPending,
  failed = false,
  onRetry,
}: {
  // 検索ごとに 1 つ。ページを跨いでも変わらない (スクロールの構えを検索ごとに取る)
  searchKey: string;
  remaining: number;
  // 次の 20 件を足す (docs/123 §4-2)。サーバ描画の頃は ?page=N+1 への
  // router.replace で 1〜N+1 ページを描き直していた
  onLoad: () => void;
  isPending: boolean;
  // 続きを読めなかった。番兵が見え続けて撃ち直しが止まらなくなるので、
  // 監視を止めて、押されたら onRetry で読み直す
  failed?: boolean;
  onRetry?: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  // 1 ペインで全画面のノートが一覧を覆っている間は読まない (useScrollArmed.ts)。
  // 次のページを読むと見ているノートが閉じる
  const { coveredByNote, mode } = useCoveredByNote();
  // 解禁は検索 (ページ番号を除いた href) ごと。下へ動いたら解禁する
  const armed = useScrollArmed(sentinelRef, searchKey, { enabled: !coveredByNote, mode });
  // 解禁前だけ、一覧が器に収まっているかを見張る。mode … 構成で器が替わる
  const fits = useFitsInScroller(
    sentinelRef,
    `${searchKey}|${mode}`,
    !armed && !coveredByNote,
  );

  const load = useCallback(() => {
    // 速度計測の開始 (docs/119 §3-1)。計測中でなければ何もしない
    perfStart("追加", "/");
    onLoad();
  }, [onLoad]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (el === null || isPending || coveredByNote || failed) return;
    // 解禁前でも、一覧が器に収まっている間は埋めてよい (loadMoreGate.ts)。
    // 追加が届いて収まらなくなれば fits が変わり、ここで止まる
    if (!shouldObserveLoadMore(armed, fits)) return;
    let observer: IntersectionObserver | undefined;
    const cancel = afterNextPaint(() => {
      // fits は state で、追加が届いた直後は「収まっていない」への更新が
      // まだ届いていないことがある。張る直前に測り直す (描画の後なので只に近い)
      if (!armed && isListScrollable(el)) return;
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) load();
        },
        // 末尾に届く 1 画面ぶん手前で先読みして、スクロールが底で止まる
        // 間を作らない。root は一覧が実際にスクロールする器 —
        // rootMargin は root の縁にしか付かないので、2 / 3 ペインの内側
        // スクロールで root を画面 (null) のままにすると、器の切り取りで
        // 余白が効かず、目印が見えてから読み込んでいた
        { root: scrollRootOf(el), rootMargin: PREFETCH_MARGIN },
      );
      observer.observe(el);
    });
    return () => {
      cancel();
      observer?.disconnect();
    };
    // mode … 構成を押した瞬間に一覧のスクロールする器 (window か内側の器) が
    // 替わる (docs/86 §4-18)。root を測り直すため作り直す
  }, [load, isPending, coveredByNote, mode, armed, fits, failed]);

  // 画像ビューアの → からの依頼 (components/search/loadMore.ts)。目印が
  // 内側スクロールの器に隠れていても読み込めるようにする
  useEffect(() => {
    if (isPending) return;
    window.addEventListener(LOAD_MORE_EVENT, load);
    return () => window.removeEventListener(LOAD_MORE_EVENT, load);
  }, [load, isPending]);

  return (
    // overflow-anchor: none が要 (検証で発覚)。末尾までスクロールした状態で
    // 行がこの要素の上に挿入されると、ブラウザのスクロールアンカリングが
    // この要素を基準に viewport を追従させ、観測が切れず全ページを連鎖
    // 読み込みしてしまう。アンカー候補から外せば viewport は既存行に留まり、
    // 伸びた分だけ画面外へ押し出されて止まる
    // aria-live … 自動で行が増えても視覚外には伝わらないので、
    // 「残り n 件」の変化 (=読み込まれたこと) を控えめに読み上げさせる
    <div
      ref={sentinelRef}
      // data-auto-load-more … 続きがあることの目印 (loadMore.ts が見る)
      data-auto-load-more=""
      aria-live="polite"
      className="flex justify-center py-2 [overflow-anchor:none]"
    >
      <button
        type="button"
        onClick={failed && onRetry ? onRetry : load}
        disabled={isPending}
        className={COMPACT_ACTION_LINK_CLASS}
      >
        {isPending
          ? "読み込み中…"
          : failed
            ? "続きを読み込めませんでした。押してもう一度"
            : `さらに表示 (残り ${remaining} 件)`}
      </button>
    </div>
  );
}
