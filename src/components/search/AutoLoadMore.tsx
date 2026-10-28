"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { PendingLink } from "@/components/chrome/PendingLink";
import { COMPACT_ACTION_LINK_CLASS } from "@/components/ui";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { keepsNoteOpen } from "@/lib/prefs/paneMode";
import { itemIdFromPathname } from "@/lib/search/url";
import { perfStart } from "@/lib/logging/perfClient";
import { LOAD_MORE_EVENT } from "./loadMore";
import { canScroll, createScrollArm, searchKeyOf } from "./loadMoreGate";

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

// 一覧 (スクロールする器、無ければ文書) がスクロールできる長さか
function isScrollable(el: HTMLElement): boolean {
  const root = scrollRootOf(el);
  return root === null
    ? canScroll(document.documentElement.scrollHeight, window.innerHeight)
    : canScroll(root.scrollHeight, root.clientHeight);
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
  // 1 ペインで全画面のノートが一覧を覆っている間は読まない (docs/86 §4-18)。
  // 次のページは router.replace で URL を一覧へ書き換えるので、裏で読むと
  // 見ているノートが閉じる。覆われた一覧の番兵は画面に入ったままなので、
  // 描き直し (ペイン構成の切り替え後の refresh など) で監視を作り直すたびに
  // 発火していた。3 / 2 ペインはノートが一覧と並ぶ常設の面で、URL が一覧へ
  // 移っても閉じない (PreviewPane) ので止めない
  const pathname = usePathname();
  const { mode } = usePaneMode();
  const coveredByNote =
    !keepsNoteOpen(mode) && itemIdFromPathname(pathname) !== null;

  // 解禁は検索 (ページ番号を除いた href) ごと。ページが進んでも同じ検索の
  // 間は解禁のまま、検索語か並び順が変わったら止め直す
  const searchKey = searchKeyOf(href);
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const armed = armedFor === searchKey;

  const load = useCallback(() => {
    // 速度計測の開始 (docs/119 §3-1)。計測中でなければ何もしない
    perfStart("追加", "/");
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }, [router, href]);

  // 解禁を待つ。一覧が実際にスクロールする器 (無ければ文書) の位置を見て、
  // 下へ動いたら解禁する。先頭へ戻されるスクロールでは解禁しない
  useEffect(() => {
    const el = sentinelRef.current;
    if (el === null || armed || coveredByNote) return;
    const root = scrollRootOf(el);
    const topOf = () => (root === null ? window.scrollY : root.scrollTop);
    const arm = createScrollArm(topOf());
    const onScroll = () => {
      if (arm(topOf())) setArmedFor(searchKey);
    };
    const target: HTMLElement | Window = root ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
    // mode … 構成を押すとスクロールする器が替わる (下の観測と同じ理由)
  }, [armed, coveredByNote, mode, searchKey]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (el === null || isPending || coveredByNote) return;
    // 解禁前でも、一覧が器に収まっている間は埋めてよい (loadMoreGate.ts)。
    // 追加が届くと href が変わって load が作り直され、ここで測り直す
    if (!armed && isScrollable(el)) return;

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
    // mode … 構成を押した瞬間に一覧のスクロールする器 (window か内側の器) が
    // 替わる (docs/86 §4-18)。root を測り直すため作り直す
  }, [load, isPending, coveredByNote, mode, armed]);

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
