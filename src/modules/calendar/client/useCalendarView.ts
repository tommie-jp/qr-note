"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { switchPaneMode } from "@/components/panes/switchPaneMode";
import { refreshServerView } from "@/lib/client/navigation";
import type { PaneMode } from "@/lib/prefs/paneMode";
import { cellHeightPx } from "./MonthGrid";
import { currentCalendarPrefs, useCalendarPrefs } from "./prefsStore";
import { revealDayWeek } from "./revealToday";
import { setSelectedCalendarDay } from "./selectedDay";

// カレンダー表示 (CalendarView) の状態と effect。CalendarView から分けた (docs/128 §3-3)

// スマホ (指で操作する端末) か。カレンダーはスマホでは 1 ペインにしない (docs/126 §1-36)
function isTouchDevice(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

// 1 ペインを 2 ペインにする (日の一覧を下のペインに出す。docs/126 §1-36・§1-39)
export function switchToTwoPanes(): void {
  void switchPaneMode("2", () => {
    startTransition(refreshServerView);
  });
}

// 開いている日。浮かせるときは押したマスの要素で位置を測る
// openedFor … 開いたときにペインに出ていたノート。別のノートが開いたら
// (戻る・一覧から開く) 日のペインはそれを覆わずに退く (画像ビューアと同じ)
export interface OpenedDay {
  day: string;
  cell: HTMLElement | null;
  openedFor: string | null;
}

export function useShownDay({
  month,
  days,
  today,
  inPane,
  detailItemId,
}: {
  month: string;
  days: readonly string[];
  today: string;
  inPane: boolean;
  detailItemId: string | null;
}) {
  const [opened, setOpened] = useState<OpenedDay | null>(null);
  // 月送りの釦は閉じてから送る。URL の書き換え (戻る・検索語) で月が替わったときも
  // 開いていた日がマス目に無ければ出さない
  if (opened !== null && opened.openedFor !== detailItemId) {
    setOpened(null);
  }
  // **2・3 ペインでは日の一覧を常に出す** (docs/126 §1-36)。選んでいなければ今日、
  // 今日の無い月はその月の 1 日。下のペインにノートを開いている間はノートに譲る
  const defaultDay = today.startsWith(month) ? today : `${month}-01`;
  const picked = opened !== null && days.includes(opened.day) && opened.openedFor === detailItemId ? opened : null;
  const shown: OpenedDay | null =
    picked ?? (inPane && detailItemId === null ? { day: defaultDay, cell: null, openedFor: null } : null);
  return { shown, setOpened };
}

// スマホで 1 ペインのまま開いたら 2 ペインにする (§1-36)。マスの横に浮かせる一覧は PC だけ
export function useTwoPanesOnTouch(mode: PaneMode): void {
  useEffect(() => {
    if (mode === "1" && isTouchDevice()) {
      switchToTwoPanes();
    }
  }, [mode]);
}

// 今日の週を見える範囲の一番上へ送る (docs/126 §1-39)。開いた直後と「今日」の釦。
// 頼みは ref に残し、今日のマスが描けたときに果たす — 「今日」で月を戻すと
// URL (useSearchParams) の書き換えは釦の描き直しより後に届くため。
// 開いた直後の最初の描画は設定の読み込み前 (既定の 1 日の予定数) のことがあり、
// マスの高さが後で変わる。描画の高さが store と食い違う間は送らずに待つ
export function useRevealToday(month: string, today: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reveal = useRef<{ smooth: boolean } | null>({ smooth: false });
  const [revealCount, setRevealCount] = useState(0);
  const { prefs } = useCalendarPrefs();
  const cellHeight = cellHeightPx(prefs.eventsPerDay);
  useEffect(() => {
    const root = rootRef.current;
    if (cellHeight !== cellHeightPx(currentCalendarPrefs().eventsPerDay)) {
      return;
    }
    if (reveal.current !== null && root !== null && revealDayWeek(root, today, reveal.current.smooth)) {
      reveal.current = null;
    }
  }, [revealCount, month, cellHeight, today]);
  // 月送りでは送らない
  const cancelReveal = () => {
    reveal.current = null;
  };
  // 「今日」の釦。なめらかに送る
  const requestReveal = () => {
    reveal.current = { smooth: true };
    setRevealCount((n) => n + 1);
  };
  return { rootRef, revealCount, cancelReveal, requestReveal };
}

// 検索窓の＋が足す日 (docs/126 §1-17)。カレンダーを離れたら忘れる
export function useSelectedDaySync(shownDay: string | null): void {
  useEffect(() => {
    setSelectedCalendarDay(shownDay);
    return () => setSelectedCalendarDay(null);
  }, [shownDay]);
}

// 日を閉じる・選ぶ
export function useDaySelection(
  setOpened: (opened: OpenedDay | null) => void,
  detailItemId: string | null,
) {
  const close = useCallback(() => setOpened(null), [setOpened]);
  const select = useCallback(
    (day: string, cell: HTMLElement) => setOpened({ day, cell, openedFor: detailItemId }),
    [detailItemId, setOpened],
  );
  return { close, select };
}
