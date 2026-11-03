// 予定カレンダーのモジュールの登録情報 (docs/126 §1-7)。registry.tsx が束ねる。
//
// 重い部品 (マス目・フォーム) は next/dynamic で遅延読み込みする。本体の束に
// 乗るのはこのファイルと、タブを出すかの判定 (parseEvent) だけ
import dynamic from "next/dynamic";
import type { Item } from "@/generated/prisma/client";
import { parseStoredProps } from "@/lib/markdown/props";
import { jstToday } from "./event/monthLayout";
import { parseEvent } from "./event/parseEvent";
import { CAL_PARAM, calendarEntryHref } from "./client/calendarUrl";

const loading = () => <p className="py-6 text-center text-sm text-gray-500">読み込み中…</p>;

export const CalendarView = dynamic(() => import("./client/CalendarView"), { loading });
export const EventForm = dynamic(() => import("./client/EventForm"), { loading });

export const CALENDAR_PARAM = CAL_PARAM;

export function calendarEnterHref(query: string): string {
  return calendarEntryHref(query, jstToday().slice(0, 7));
}

// ノートに「予定」タブを出すか。本文に読める date= がある、または URL が
// 予定タブを求めている (新しい予定を足すときは、まだ本文が無い)
export function isEventNote(item: Item | null): boolean {
  return item !== null && parseEvent(parseStoredProps(item.props)) !== null;
}

export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
