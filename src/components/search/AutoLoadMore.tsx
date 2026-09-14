"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";
import { PendingLink } from "@/components/PendingLink";
import { COMPACT_ACTION_LINK_CLASS } from "@/components/ui";

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
      // 末尾に届く少し手前 (1 画面の 1/4 ほど) で先読みして、
      // スクロールが底で止まる感じを減らす
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
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
