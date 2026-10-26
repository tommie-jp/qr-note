"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";
import { PendingLink } from "@/components/chrome/PendingLink";
import { COMPACT_ACTION_LINK_CLASS } from "@/components/ui";
import { LOAD_MORE_EVENT } from "./loadMore";

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
// 先読みの距離。root の高さに対する割合 (1 画面ぶん)
const PREFETCH_MARGIN = "100% 0px";

// 一覧が内側でスクロールしている器 (2 / 3 ペイン・広い画面の [data-results-scroll])。
// **実際に overflow でスクロールしているときだけ** root にする — 文書ごと
// スクロールする構成 (1 ペインの狭い画面) で器を root にすると、器は切り取らない
// ので目印が常に「見えている」扱いになり、全ページを連鎖読み込みしてしまう
function scrollRootOf(el: HTMLElement): HTMLElement | null {
  const scroller = el.closest<HTMLElement>("[data-results-scroll]");
  if (scroller === null) {
    return null;
  }
  const { overflowY } = getComputedStyle(scroller);
  return overflowY === "auto" || overflowY === "scroll" ? scroller : null;
}

export function AutoLoadMore({
  href,
  remaining,
}: {
  href: string;
  remaining: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }, [router, href]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (el === null || isPending) return;

    const observer = new IntersectionObserver(
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
    return () => observer.disconnect();
  }, [load, isPending]);

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
      <PendingLink
        href={href}
        replace
        scroll={false}
        className={COMPACT_ACTION_LINK_CLASS}
      >
        {isPending ? "読み込み中…" : `さらに表示 (残り ${remaining} 件)`}
      </PendingLink>
    </div>
  );
}
