// core が読むモジュールの登録口 (docs/126 §1-7)。
//
// 検索結果の表示 (一覧の代わりに出す物) とノートのタブ (markdown・テキスト・
// 編集の隣に足す物) を、モジュールがここへ登録する。core はこの一覧を回すだけで、
// 個々の機能の名前を知らない。機能を足すとき core に足すのはここの 1 行
//
// eslint (no-restricted-imports) が core からモジュールの中身への import を止める
import type { ComponentType, ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import {
  CALENDAR_PARAM,
  CalendarIcon,
  CalendarView,
  calendarEnterHref,
  calendarNewItemHref,
  refreshCalendar,
  EventForm,
  isEventNote,
} from "./calendar";

// --- 検索結果の表示 ---

export interface ResultView {
  id: string;
  // この表示を選ぶ URL の引数 (値は表示が決める。カレンダーなら月)
  param: string;
  label: string;
  icon: ReactNode;
  // 一覧からこの表示へ移る URL
  enterHref: (query: string) => string;
  // 検索窓の＋で開く URL (この表示を出している間だけ。無ければ普通の新規ノート)。
  // 押したときに呼ぶ
  newItemHref?: (query: string, params: ParamsLike) => string;
  // ヘッダーのロゴで再表示するときに、表示の控えを古くして取り直させる
  refresh?: () => void;
  // この表示の間は 1 ペインにしない (境界の引き切り・構成の釦。docs/86 §4-28)
  keepsPanes?: boolean;
  Component: ComponentType<{ query: string }>;
}

export const RESULT_VIEWS: readonly ResultView[] = [
  {
    id: "calendar",
    param: CALENDAR_PARAM,
    label: "カレンダー",
    icon: <CalendarIcon />,
    enterHref: calendarEnterHref,
    newItemHref: calendarNewItemHref,
    refresh: refreshCalendar,
    keepsPanes: true,
    Component: CalendarView,
  },
];

interface ParamsLike {
  get(name: string): string | null;
}

// URL が選んでいる表示。無ければ null (一覧)
export function activeResultView(params: ParamsLike): ResultView | null {
  return RESULT_VIEWS.find((view) => params.get(view.param) !== null) ?? null;
}

// いまの表示が 1 ペインを許すか (カレンダーは許さない)
export function allowsSinglePane(params: ParamsLike): boolean {
  return activeResultView(params)?.keepsPanes !== true;
}

// 検索語を打ち替えた URL に、いまの表示の引数を持ち越す (カレンダーを
// 出したまま検索式を変えられるように)
export function carryResultViewParams(href: string, current: ParamsLike): string {
  const view = activeResultView(current);
  const value = view === null ? null : current.get(view.param);
  if (view === null || value === null) {
    return href;
  }
  const url = new URL(href, "http://x");
  url.searchParams.set(view.param, value);
  return `${url.pathname}${url.search}`;
}

// --- ノートのタブ ---

export interface NoteTabContext {
  itemId: string;
  item: Item | null;
  // URL の ?tab= と ?date= (開いたときの値)
  tab: string | null;
  date: string | null;
  // いまの検索式
  query: string;
  // 全画面 (1 ペイン) で開いているか
  fullscreen: boolean;
}

export interface NoteTab {
  // URL の ?tab= の値にもなる
  key: string;
  label: string;
  content: ReactNode;
}

export function noteTabsFor(ctx: NoteTabContext): NoteTab[] {
  const tabs: NoteTab[] = [];
  if (isEventNote(ctx.item) || ctx.tab === "event") {
    tabs.push({
      key: "event",
      label: "予定",
      content: (
        <EventForm
          itemId={ctx.itemId}
          item={ctx.item}
          initialDate={ctx.date}
          query={ctx.query}
          fullscreen={ctx.fullscreen}
        />
      ),
    });
  }
  return tabs;
}
