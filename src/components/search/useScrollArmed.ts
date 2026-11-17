"use client";

import { type RefObject, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { afterNextPaint } from "@/lib/afterNextPaint";
import { keepsNoteOpen } from "@/lib/prefs/paneMode";
import { itemIdFromPathname } from "@/lib/search/url";
import { createScrollArm } from "./loadMoreGate";
import { scrollRootOf } from "./useFitsInScroller";

// 続きの自動読み込みの門 (docs/118 §2)。AutoLoadMore と枠 (PlaceholderPages) が使う。

// 1 ペインで全画面のノートが一覧を覆っている間は読まない (docs/86 §4-18)。
// 覆われた一覧の目印は画面に入ったままなので、描き直しのたびに発火していた。
// 3 / 2 ペインはノートが一覧と並ぶ常設の面なので止めない
export function useCoveredByNote(): { coveredByNote: boolean; mode: string } {
  const pathname = usePathname();
  const { mode } = usePaneMode();
  return { coveredByNote: !keepsNoteOpen(mode) && itemIdFromPathname(pathname) !== null, mode };
}

// 検索の直後は、利用者が一覧を下へスクロールするまで先読みしない。
// 解禁は検索 (searchKey) ごと。ページが進んでも同じ検索の間は解禁のまま。
//
// 器を測るのは描画の後。scrollRootOf の getComputedStyle は、描画の直後に
// 読むとスタイルを前倒しで強制し、最初の 1 枚を遅らせていた (docs/122 §10-2)
export function useScrollArmed(
  ref: RefObject<HTMLElement | null>,
  searchKey: string,
  { enabled, mode }: { enabled: boolean; mode: string },
): boolean {
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const armed = armedFor === searchKey;
  useEffect(() => {
    const el = ref.current;
    if (el === null || armed || !enabled) return;
    let detach: (() => void) | undefined;
    const cancel = afterNextPaint(() => {
      const root = scrollRootOf(el);
      const topOf = () => (root === null ? window.scrollY : root.scrollTop);
      const arm = createScrollArm(topOf());
      const onScroll = () => {
        if (arm(topOf())) setArmedFor(searchKey);
      };
      const target: HTMLElement | Window = root ?? window;
      target.addEventListener("scroll", onScroll, { passive: true });
      detach = () => target.removeEventListener("scroll", onScroll);
    });
    return () => {
      cancel();
      detach?.();
    };
    // mode … 構成を押すとスクロールする器が替わる
  }, [ref, armed, enabled, mode, searchKey]);
  return armed;
}
