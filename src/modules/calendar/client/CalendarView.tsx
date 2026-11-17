"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { notePaneLayout, type PaneMode } from "@/lib/prefs/paneMode";
import { addMonths, eventsByDay, isMonth, jstToday, monthCells, type DayEvent } from "../event/monthLayout";
import { calendarCache } from "./calendarStore";
import { CAL_PARAM, withCalendarMonth } from "./calendarUrl";
import { CalendarHead, CalendarNotices } from "./CalendarHead";
import { DayPane } from "./DayPane";
import { DayPopover } from "./DayPopover";
import { MonthGrid } from "./MonthGrid";
import {
  switchToTwoPanes,
  useDaySelection,
  useRevealToday,
  useSelectedDaySync,
  useShownDay,
  useTwoPanesOnTouch,
  type OpenedDay,
} from "./useCalendarView";

// URL の cal を書き換える。履歴を増やさない (月送りは「戻る」で辿る物ではない)。
// Next は外からの replaceState に useSearchParams を追随させる (docs/123 §4-2)
function replaceMonth(month: string | null): void {
  window.history.replaceState(null, "", withCalendarMonth(new URL(location.href), month));
}

function pushList(): void {
  window.history.pushState(null, "", withCalendarMonth(new URL(location.href), null));
}

// 予定の無い日に渡す空の並び。描くたびに [] を作ると、日の一覧が
// 「予定が変わった」と見て控えを直し続ける
const NO_EVENTS: readonly DayEvent[] = [];

// 月送りと「今日」の釦。月送りの釦は閉じてから送る
function monthNav({
  month,
  today,
  mode,
  closeDay,
  cancelReveal,
  requestReveal,
}: {
  month: string;
  today: string;
  mode: PaneMode;
  closeDay: () => void;
  cancelReveal: () => void;
  requestReveal: () => void;
}) {
  const goMonth = (delta: -1 | 1) => {
    closeDay();
    cancelReveal();
    replaceMonth(addMonths(month, delta));
  };
  const goToday = () => {
    // 今日のマスの週を一番上へ、日の一覧は今日の予定を先頭から (docs/126 §1-39)。
    // 1 ペイン (PC の浮かせる一覧) は 2 ペインにして下のペインに今日を出す
    closeDay();
    requestReveal();
    replaceMonth(today.slice(0, 7));
    if (mode === "1") {
      switchToTwoPanes();
    }
  };
  return { goMonth, goToday };
}

// 月の予定 (控えから。届くまでは payload が undefined)
function useMonthEvents(query: string, month: string, days: readonly string[]) {
  const key = useMemo(() => ({ query, month }), [query, month]);
  const entry = calendarCache.useEntry(key);
  const payload = entry?.value;
  const byDay = useMemo(() => eventsByDay(payload?.events ?? [], days), [payload, days]);
  return { key, entry, payload, byDay };
}

// 選んだ日の予定。2・3 ペインは下のペイン (DayPane)、1 ペインは押したマスの横 (DayPopover)
function ShownDay({
  shown,
  inPane,
  events,
  loading,
  query,
  month,
  revealKey,
  resizer,
  onClose,
}: {
  shown: OpenedDay;
  inPane: boolean;
  events: readonly DayEvent[];
  loading: boolean;
  query: string;
  month: string;
  revealKey: number;
  resizer: ReactNode;
  onClose: () => void;
}) {
  if (inPane) {
    return (
      <DayPane key={shown.day} day={shown.day} events={events} loading={loading} query={query} revealKey={revealKey} resizer={resizer} />
    );
  }
  if (shown.cell === null) {
    return null;
  }
  return (
    <DayPopover
      key={shown.day}
      day={shown.day}
      anchor={shown.cell}
      events={events}
      loading={loading}
      query={query}
      month={month}
      onClose={onClose}
    />
  );
}

// 検索結果のカレンダー表示 (docs/126 §1-3)。検索式に当たる予定を月のマス目に並べる。
// 検索窓・ペインの器は一覧と共有し、ここが持つのは結果の中身だけ
export default function CalendarView({
  query,
  previewResizer,
}: {
  query: string;
  // 日のペインの境界。core が作って渡す (registry.tsx の ResultViewProps。docs/128 §3-4)
  previewResizer: ReactNode;
}) {
  const params = useSearchParams();
  // 2・3 ペインは選んだ日を下のペインに出す。1 ペインはペインが無いのでマスの横に浮かせる
  const { mode, detailItemId } = usePaneMode();
  const inPane = notePaneLayout(mode) === "pane";
  const [today] = useState(() => jstToday());
  const raw = params.get(CAL_PARAM) ?? "";
  const month = isMonth(raw) ? raw : today.slice(0, 7);
  const days = useMemo(() => monthCells(month), [month]);
  const { shown, setOpened } = useShownDay({ month, days, today, inPane, detailItemId });
  useTwoPanesOnTouch(mode);
  const { rootRef, revealCount, cancelReveal, requestReveal } = useRevealToday(month, today);
  useSelectedDaySync(shown?.day ?? null);
  const { close, select } = useDaySelection(setOpened, detailItemId);

  const { key, entry, payload, byDay } = useMonthEvents(query, month, days);
  const loading = payload === undefined;
  const { goMonth, goToday } = monthNav({ month, today, mode, closeDay: close, cancelReveal, requestReveal });

  return (
    <div ref={rootRef} data-calendar="">
      <CalendarHead month={month} onPrev={() => goMonth(-1)} onNext={() => goMonth(1)} onToday={goToday} onList={pushList} />

      <CalendarNotices
        error={entry?.error && loading ? entry.error : null}
        omitted={payload?.omitted ?? 0}
        onRetry={() => calendarCache.load(key, { force: true })}
      />

      <div className={loading ? "opacity-50" : undefined} aria-busy={loading}>
        <MonthGrid month={month} days={days} byDay={byDay} today={today} selected={shown?.day ?? null} onSelect={select} />
      </div>
      {shown !== null && (
        <ShownDay
          shown={shown}
          inPane={inPane}
          events={byDay.get(shown.day) ?? NO_EVENTS}
          loading={loading}
          query={query}
          month={month}
          revealKey={revealCount}
          resizer={previewResizer}
          onClose={close}
        />
      )}
    </div>
  );
}
