"use client";

import { useState, type ReactNode } from "react";
import { holidayName } from "../event/holidays";
import { compareDayEvents, eventEndLabel, eventTimeLabel, type DayEvent } from "../event/monthLayout";
import { saveEventDone } from "./eventDone";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function dayLabel(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 (${WEEKDAYS[weekday]})`;
}

// 見出しに見せる形 (SaiSuke2 と同じ「10/31 土曜日」)。読み上げの名前は dayLabel
export function dayTitle(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8))} ${WEEKDAYS[weekday]}曜日`;
}

// 時刻は先頭の 0 を落とす (09:30 → 9:30)
const shortTime = (time: string) => time.replace(/^0/, "");

// 予定の行は SaiSuke2 と同じく色の帯 (未済は赤、済みは灰)。高さは 2 行ぶん (56px) で、
// 左に時刻 (開始と終了の 2 段、終日は「終日」)、右に題名。色は行の器 (li) が持つ
export const DAY_ROW_CLASS = "flex min-h-14 min-w-0 flex-1 items-center gap-3 px-1 text-left text-base leading-6 hover:brightness-95";

// 済みの予定は題名に取り消し線を引く (マス目と同じ)
export function DayRowContent({ event }: { event: DayEvent }) {
  const start = eventTimeLabel(event);
  const end = eventEndLabel(event);
  return (
    <>
      <span className="flex w-14 shrink-0 flex-col items-center text-base leading-6 opacity-90">
        {start === null ? (
          "終日"
        ) : (
          <>
            <span>{shortTime(start)}</span>
            {end !== null && <span>{shortTime(end)}</span>}
          </>
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate ${event.done ? "line-through" : ""}`}>
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
      className="flex w-9 shrink-0 items-center justify-center self-stretch"
    >
      <span
        aria-hidden="true"
        className={`flex size-6 items-center justify-center rounded-full border-2 text-sm leading-none font-bold ${
          done ? "border-emerald-600 bg-emerald-600 text-white" : "border-white/90 text-transparent"
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
    <div>
      {/* 見出しの帯 (SaiSuke2 と同じ緑) */}
      <div className="flex items-center gap-2 bg-[#82bd8a] px-2 py-0.5 text-white">
        <h3 className="min-w-0 flex-1 truncate text-lg leading-8">
          {dayTitle(day)}
          {holidayName(day) !== null && <span className="ml-2 text-base">{holidayName(day)}</span>}
        </h3>
        <button
          type="button"
          onClick={(e) => onAdd(e.currentTarget)}
          aria-label="予定を追加"
          title="予定を追加"
          className="flex size-7 items-center justify-center rounded bg-white text-lg leading-none font-medium text-emerald-700 active:bg-gray-100"
        >
          ＋
        </button>
        {trailing}
      </div>
      {events.length === 0 ? (
        <p className="px-2 py-2 text-base text-gray-500">{loading ? "読み込み中…" : "予定はありません"}</p>
      ) : (
        <ul className="space-y-0.5 pt-0.5">
          {shown.map((event) => (
            <li
              key={event.itemId}
              className={`flex items-stretch rounded-sm ${
                event.done ? "bg-gray-200 text-gray-500" : "bg-rose-500 text-white"
              }`}
            >
              <DoneButton event={event} onToggle={() => toggle(event, event.done !== true)} />
              {renderRow(event)}
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="mt-1 rounded bg-yellow-50 px-2 py-1 text-sm text-yellow-800">
          {error}
        </p>
      )}
    </div>
  );
}
