"use client";

import { useState, type ReactNode } from "react";
import { compareDayEvents, eventTimeLabel, type DayEvent } from "../event/monthLayout";
import { saveEventDone } from "./eventDone";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function dayLabel(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 (${WEEKDAYS[weekday]})`;
}

// 行は 24px (min-h-6、文字 1 行ぶん) に詰める。1 日に何件あっても一覧として見渡せるように
export const DAY_ROW_CLASS = "flex min-h-6 min-w-0 flex-1 items-center gap-2 px-1 text-left text-sm leading-6 hover:bg-gray-50";

// 済みの予定は題名に取り消し線を引いて薄くする (マス目と同じ)
export function DayRowContent({ event }: { event: DayEvent }) {
  return (
    <>
      <span className="w-10 shrink-0 text-xs text-gray-500">{eventTimeLabel(event) ?? "終日"}</span>
      <span className={`min-w-0 flex-1 truncate ${event.done ? "text-gray-400 line-through" : ""}`}>
        {event.title || "(無題)"}
      </span>
    </>
  );
}

// 済みの釦。丸の中に ✓。押した側の値はすぐ見せ、保存は裏で行う (DayEventList)
function DoneButton({ event, onToggle }: { event: DayEvent; onToggle: () => void }) {
  const done = event.done === true;
  return (
    <button
      type="button"
      aria-pressed={done}
      aria-label={`${event.title || "(無題)"} を${done ? "未済に戻す" : "済みにする"}`}
      title={done ? "未済に戻す" : "済みにする"}
      onClick={onToggle}
      className="flex size-6 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden="true"
        className={`flex size-4 items-center justify-center rounded-full border text-[10px] leading-none font-bold ${
          done ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-400 text-transparent hover:border-emerald-600"
        }`}
      >
        ✓
      </span>
    </button>
  );
}

// 押した「済み」を、サーバの応答 (月の予定の取り直し) が追いつくまで上書きして見せる
function useDoneOverrides(events: readonly DayEvent[]) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // 取り直した予定が押した値に追いついたら上書きを外す (前の描画の値を
  // state に控えて描画中に直す React の作法)
  const [seen, setSeen] = useState(events);
  if (seen !== events) {
    setSeen(events);
    const next = new Map([...overrides].filter(([id, done]) => events.find((e) => e.itemId === id)?.done !== done));
    if (next.size !== overrides.size) {
      setOverrides(next);
    }
  }

  const toggle = (event: DayEvent, done: boolean) => {
    setError(null);
    setOverrides((prev) => new Map(prev).set(event.itemId, done));
    void saveEventDone(event.itemId, done).then((message) => {
      if (message === null) {
        return;
      }
      setError(message);
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(event.itemId);
        return next;
      });
    });
  };

  // 押した値で並べ直す (済みは最後。マス目の並びと同じ)
  const shown = events
    .map((event) => (overrides.has(event.itemId) ? { ...event, done: overrides.get(event.itemId) } : event))
    .sort(compareDayEvents);
  return { shown, toggle, error };
}

// 選んだ日の見出し・「+」・予定の行 (docs/126 §1-6)。浮かせた一覧 (1 ペイン) と
// 下のペイン (2・3 ペイン) が共有する。行を押したときの動きは器が決める (renderRow)。
// 行の左端は「済み」の釦 (docs/126 §1-8)
export function DayEventList({
  day,
  events,
  loading,
  onAdd,
  renderRow,
  trailing,
}: {
  day: string;
  events: readonly DayEvent[];
  // 月の予定がまだ届いていない (「予定はありません」と言わない)
  loading: boolean;
  // 押した「+」の要素を渡す (そのそばにフォームを出すため)
  onAdd: (button: HTMLElement) => void;
  renderRow: (event: DayEvent) => ReactNode;
  // 見出し行の右端に足す物 (ペインの「閉じる」)
  trailing?: ReactNode;
}) {
  const { shown, toggle, error } = useDoneOverrides(events);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{dayLabel(day)}</h3>
        <button
          type="button"
          onClick={(e) => onAdd(e.currentTarget)}
          aria-label="予定を追加"
          title="予定を追加"
          className="flex size-7 items-center justify-center rounded bg-blue-600 text-base leading-none font-medium text-white active:bg-blue-700"
        >
          ＋
        </button>
        {trailing}
      </div>
      {events.length === 0 ? (
        <p className="py-0.5 text-sm text-gray-500">{loading ? "読み込み中…" : "予定はありません"}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map((event) => (
            <li key={event.itemId} className="flex items-center">
              <DoneButton event={event} onToggle={() => toggle(event, event.done !== true)} />
              {renderRow(event)}
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="rounded bg-yellow-50 px-2 py-1 text-sm text-yellow-800">
          {error}
        </p>
      )}
    </div>
  );
}
