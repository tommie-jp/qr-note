"use client";

import { useRef, useState, type ReactNode } from "react";
import { holidayName } from "../event/holidays";
import { compareDayEvents, eventEndLabel, eventTimeLabel, type DayEvent } from "../event/monthLayout";
import { saveEventDone, saveEventTitle } from "./eventDone";
import { useCalendarPrefs } from "./prefsStore";
import { eventColor } from "./priorityColor";

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

// 予定の行は SaiSuke2 と同じく色の帯 (優先度の色は設定から、済みは灰。priorityColor.ts)。
// 高さは題名の文字 1.5 行ぶん (24px × 1.5 = 36px)。左に時刻 (開始と終了を小さい文字の
// 2 段、終日は「終日」)、右に題名。色は行の器 (li) が持つ
export const DAY_ROW_CLASS = "flex min-h-9 min-w-0 flex-1 items-center gap-3 px-1 text-left text-base leading-6 hover:brightness-95";

function TimeLabel({ event }: { event: DayEvent }) {
  const start = eventTimeLabel(event);
  const end = eventEndLabel(event);
  return (
    <span className="flex w-12 shrink-0 flex-col items-center text-xs leading-4 opacity-90">
      {start === null ? (
        "終日"
      ) : (
        <>
          <span>{shortTime(start)}</span>
          {end !== null && <span>{shortTime(end)}</span>}
        </>
      )}
    </span>
  );
}

// 済みの予定は題名に取り消し線を引く (マス目と同じ)。
// 題名の文字 (data-event-title) を押すとインライン編集 (DayEventList)。文字の幅だけを
// 的にし、行の残り (時刻・余白) は器の動き (フォーム・ノートを開く) に残す
export function DayRowContent({ event }: { event: DayEvent }) {
  return (
    <>
      <TimeLabel event={event} />
      <span className="min-w-0 flex-1 truncate">
        <span data-event-title="" className={`cursor-text ${event.done ? "line-through" : ""}`}>
          {event.title || "(無題)"}
        </span>
      </span>
    </>
  );
}

// 題名のインライン編集の欄。Enter・外を押すで確定、Esc で取り消し。
// 空にしたら元のまま (題名の無い予定はマス目で見分けが付かない)
function TitleEditor({
  event,
  onCommit,
  onCancel,
}: {
  event: DayEvent;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(event.title);
  // Enter で確定した後、欄が消えるときの blur で 2 度確定しない
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    const title = value.trim();
    if (commit && title !== "" && title !== event.title) {
      onCommit(title);
    } else {
      onCancel();
    }
  };
  return (
    <div className="flex min-h-9 min-w-0 flex-1 items-center gap-3 px-1">
      <TimeLabel event={event} />
      <input
        aria-label="題名"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            // ペインの Esc (閉じる) まで届かせない
            e.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
        autoFocus
        enterKeyHint="done"
        className="min-w-0 flex-1 rounded border border-gray-400 bg-white px-1 text-base leading-6 text-gray-900"
      />
    </div>
  );
}

// 済みの釦。丸の中に ✓。押した側の値はすぐ見せ、保存は裏で行う (DayEventList)。
// 未済の丸は灰の縁に白の中身 — 地の色 (設定で白にもできる) に溶けないように
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
        className={`flex size-5 items-center justify-center rounded-full border-2 text-xs leading-none font-bold ${
          done ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-400 bg-white text-transparent"
        }`}
      >
        ✓
      </span>
    </button>
  );
}

type Override = Partial<Pick<DayEvent, "done" | "title">>;

const caughtUp = (event: DayEvent | undefined, override: Override) =>
  event !== undefined &&
  (override.done === undefined || event.done === override.done) &&
  (override.title === undefined || event.title === override.title);

// 押した「済み」・直した題名を、サーバの応答 (月の予定の取り直し) が追いつくまで
// 上書きして見せる
function useEventOverrides(events: readonly DayEvent[]) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Override>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // 取り直した予定が上書きに追いついたら外す (前の描画の値を
  // state に控えて描画中に直す React の作法)
  const [seen, setSeen] = useState(events);
  if (seen !== events) {
    setSeen(events);
    const next = new Map(
      [...overrides].filter(([id, override]) => !caughtUp(events.find((e) => e.itemId === id), override)),
    );
    if (next.size !== overrides.size) {
      setOverrides(next);
    }
  }

  const apply = (itemId: string, override: Override, save: Promise<string | null>) => {
    setError(null);
    setOverrides((prev) => new Map(prev).set(itemId, { ...prev.get(itemId), ...override }));
    void save.then((message) => {
      if (message === null) {
        return;
      }
      setError(message);
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
    });
  };

  const toggle = (event: DayEvent, done: boolean) => apply(event.itemId, { done }, saveEventDone(event.itemId, done));
  const rename = (event: DayEvent, title: string) => apply(event.itemId, { title }, saveEventTitle(event.itemId, title));

  // 上書きした値で並べ直す (済みは最後。マス目の並びと同じ)
  const shown = events
    .map((event) => {
      const override = overrides.get(event.itemId);
      return override === undefined ? event : { ...event, ...override };
    })
    .sort(compareDayEvents);
  return { shown, toggle, rename, error };
}

// 選んだ日の見出し・「+」・予定の行 (docs/126 §1-6)。浮かせた一覧 (1 ペイン) と
// 下のペイン (2・3 ペイン) が共有する。行を押したときの動きは器が決める (renderRow)。
// 行の左端は「済み」の釦 (docs/126 §1-8)。inlineTitle なら題名の文字を押すと
// その場で直せる (§1-13。F2 でも)
export function DayEventList({
  day,
  events,
  loading,
  onAdd,
  renderRow,
  trailing,
  inlineTitle = false,
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
  // 題名のインライン編集を許すか。1 ペインの浮かせる一覧はリンクで、押した瞬間に
  // ノートへ移る (clientNoteNav が先に受ける) ので付けない
  inlineTitle?: boolean;
}) {
  const { shown, toggle, rename, error } = useEventOverrides(events);
  // 題名を直している予定
  const [renaming, setRenaming] = useState<string | null>(null);
  const { prefs } = useCalendarPrefs();
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
          {shown.map((event) => {
            const color = eventColor(event, prefs);
            return (
              <li
                key={event.itemId}
                data-priority={event.priority ?? "normal"}
                style={color.style}
                // 薄い縁 … 地を白にした行どうしも見分けが付くように
                className={`flex items-stretch rounded-sm ring-1 ring-black/10 ring-inset ${color.className}`}
                // 題名の文字を押したら、行の動き (フォームを開く) より先に受けて編集にする
                onClickCapture={(e) => {
                  if (inlineTitle && e.target instanceof Element && e.target.closest("[data-event-title]")) {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenaming(event.itemId);
                  }
                }}
                onKeyDown={(e) => {
                  if (inlineTitle && e.key === "F2" && renaming === null) {
                    e.preventDefault();
                    setRenaming(event.itemId);
                  }
                }}
              >
                <DoneButton event={event} onToggle={() => toggle(event, event.done !== true)} />
                {renaming === event.itemId ? (
                  <TitleEditor
                    event={event}
                    onCommit={(title) => {
                      setRenaming(null);
                      rename(event, title);
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  renderRow(event)
                )}
              </li>
            );
          })}
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
