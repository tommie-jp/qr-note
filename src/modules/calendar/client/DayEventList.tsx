"use client";

import { useRef, useState, type ReactNode } from "react";
import { holidayName } from "../event/holidays";
import { eventSpan, jstParts } from "../event/eventTime";
import { compareDayEvents, eventEndLabel, eventTimeLabel, type DayEvent } from "../event/monthLayout";
import type { TimeRange } from "../event/timeOptions";
import { saveEventDate, saveEventDone, saveEventOrder, saveEventTime, saveEventTitle } from "./eventDone";
import { TimePopover } from "./TimePopover";
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
// 高さは 28px (題名の 1 行 24px + 上下 2px。docs/126 §1-26 で 36px から詰めた)。
// 左に時刻 (1 行、終日は「終日」)、右に題名。色は行の器 (li) が持つ
export const DAY_ROW_CLASS = "flex min-h-7 min-w-0 flex-1 items-center gap-2 px-1 text-left text-base leading-6 hover:brightness-95";

// 時刻は 1 行 (「10:00 ~ 11:00」)。終日は「終日」。押すと時刻のパネル (data-event-time)
function TimeLabel({ event }: { event: DayEvent }) {
  const start = eventTimeLabel(event);
  const end = eventEndLabel(event);
  return (
    <span data-event-time="" className="w-20 shrink-0 cursor-pointer text-center text-xs leading-6 whitespace-nowrap tabular-nums opacity-90">
      {start === null ? "終日" : `${shortTime(start)} ~ ${end === null ? "" : shortTime(end)}`}
    </span>
  );
}

// 予定のいまの時刻 (パネルの初期値)。終日は null
function rangeOf(event: DayEvent): TimeRange | null {
  const start = eventTimeLabel(event);
  return start === null ? null : { start, end: eventEndLabel(event) };
}

// 時刻を変えた予定を、保存の前から一覧に見せるための値 (日付は予定の開始の日)
function withRange(event: DayEvent, range: TimeRange | null): Pick<DayEvent, "start" | "end" | "allDay"> {
  const date = jstParts(new Date(event.start)).date;
  const span = eventSpan({ date, start: range?.start ?? null, end: range?.end ?? null, until: null });
  return { start: span.start.toISOString(), end: span.end.toISOString(), allDay: span.allDay };
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
    <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-1">
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

// 並べ替えのつまみ (︙)。上下にドラッグする (ポインタ。指でも)。月のマス目の別の日の
// マスまで持っていって離すと、その日へ移す (§1-16)。焦点があれば ↑ ↓ でも動く。
// touch-none … 指でなぞったときに一覧ごとスクロールさせない
function DragHandle({
  event,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onStep,
}: {
  event: DayEvent;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerEnd: (commit: boolean) => void;
  onStep: (delta: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${event.title || "(無題)"} を並べ替える`}
      title="ドラッグで並べ替える (↑ ↓ でも)"
      data-drag-handle=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => onPointerEnd(true)}
      onPointerCancel={() => onPointerEnd(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onStep(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      className="flex w-6 shrink-0 cursor-grab touch-none items-center justify-center self-stretch text-lg leading-none opacity-60 select-none active:cursor-grabbing"
    >
      ︙
    </button>
  );
}

// ドラッグ中の並び。ids はいま見せている順、startIds は掴んだときの順、mids は掴んだ
// ときの各行の縦の中心 (この位置との比べで落とし先を決める。行が入れ替わっても動かない)
// dropDay … 指が別の日のマスの上にあればその日 (離すとその日へ移す。§1-16)
interface DragState {
  id: string;
  ids: readonly string[];
  startIds: readonly string[];
  mids: readonly number[];
  dropDay: string | null;
}

// 移す先のマスの目印 (MonthGrid が data-[drop-target] で枠を描く)
const DROP_TARGET = "data-drop-target";

function markDropTarget(day: string | null): void {
  for (const cell of document.querySelectorAll(`[${DROP_TARGET}]`)) {
    cell.removeAttribute(DROP_TARGET);
  }
  if (day !== null) {
    document.querySelector(`[data-day="${day}"]`)?.setAttribute(DROP_TARGET, "");
  }
}

// 指の下の日のマス。今の日・マス以外は null
function dayUnder(x: number, y: number, today: string): string | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
  const day = cell?.dataset.day ?? null;
  return day === today ? null : day;
}

// 落とし先: 掴んだ行を除いた各行の中心のうち、指より上にある数
function dropIndex(drag: DragState, y: number): number {
  const from = drag.startIds.indexOf(drag.id);
  return drag.mids.filter((mid, index) => index !== from && mid < y).length;
}

function moveId(ids: readonly string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  return [...rest.slice(0, to), id, ...rest.slice(to)];
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
      className="flex w-6 shrink-0 items-center justify-center self-stretch"
    >
      <span
        aria-hidden="true"
        className={`flex size-4 items-center justify-center rounded-full border-2 text-[0.625rem] leading-none font-bold ${
          done ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-400 bg-white text-transparent"
        }`}
      >
        ✓
      </span>
    </button>
  );
}

type EventFields = Partial<Pick<DayEvent, "done" | "title" | "start" | "end" | "allDay" | "order">>;
// movedTo … 別の日へ移した (月の予定を取り直すまで、この日の一覧から隠す)
type Override = EventFields & { movedTo?: string };

const caughtUp = (event: DayEvent | undefined, override: Override) => {
  if (override.movedTo !== undefined) {
    // 取り直した一覧から消えたら追いついた
    return event === undefined;
  }
  return (
    event !== undefined &&
    (Object.keys(override) as (keyof EventFields)[]).every((key) => event[key] === override[key])
  );
};

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
  // 並べ替えた順 (番号の並び) に order=1, 2, … を振る。変わった予定だけ保存する
  const reorder = (ids: readonly string[]) => {
    ids.forEach((id, index) => {
      const order = index + 1;
      const current = overrides.get(id)?.order ?? events.find((e) => e.itemId === id)?.order;
      if (current !== order) {
        apply(id, { order }, saveEventOrder(id, order));
      }
    });
  };
  const move = (event: DayEvent, date: string) =>
    apply(event.itemId, { movedTo: date }, saveEventDate(event.itemId, date));
  const retime = (event: DayEvent, range: TimeRange | null) =>
    apply(event.itemId, withRange(event, range), saveEventTime(event.itemId, range?.start ?? null, range?.end ?? null));

  // 上書きした値で並べ直す (済みは最後。マス目の並びと同じ)
  const shown = events
    .filter((event) => overrides.get(event.itemId)?.movedTo === undefined)
    .map((event) => {
      const override = overrides.get(event.itemId);
      return override === undefined ? event : { ...event, ...override };
    })
    .sort(compareDayEvents);
  return { shown, toggle, rename, retime, reorder, move, error };
}

// 選んだ日の見出し・「+」・予定の行 (docs/126 §1-6)。浮かせた一覧 (1 ペイン) と
// 下のペイン (2・3 ペイン) が共有する。行を押したときの動きは器が決める (renderRow)。
// 行の左端は並べ替えのつまみ (︙、§1-15) と「済み」の釦 (docs/126 §1-8)。inlineEdit なら題名の文字を押すと
// その場で直せ (§1-13。F2 でも)、時刻を押すと 15 分刻みの時刻のパネルが出る (§1-14)
export function DayEventList({
  day,
  events,
  loading,
  onAdd,
  renderRow,
  trailing,
  inlineEdit = false,
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
  // 題名・時刻をその場で直せるか。1 ペインの浮かせる一覧はリンクで、押した瞬間に
  // ノートへ移る (clientNoteNav が先に受ける) ので付けない
  inlineEdit?: boolean;
}) {
  const { shown, toggle, rename, retime, reorder, move, error } = useEventOverrides(events);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // ドラッグ中は指の位置の並びで見せる
  const rows =
    drag === null
      ? shown
      : drag.ids.flatMap((id) => shown.filter((event) => event.itemId === id));
  const startDrag = (event: DayEvent, e: React.PointerEvent<HTMLButtonElement>) => {
    const items = listRef.current === null ? [] : [...listRef.current.children];
    const ids = shown.map((x) => x.itemId);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      id: event.itemId,
      ids,
      startIds: ids,
      mids: items.map((li) => {
        const rect = li.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }),
      dropDay: null,
    });
  };
  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (drag === null) {
      return;
    }
    // 別の日のマスの上なら移す (並べ替えはしない)。でなければ一覧の中の並べ替え
    const dropDay = dayUnder(e.clientX, e.clientY, day);
    const ids = dropDay !== null ? drag.startIds : moveId(drag.startIds, drag.id, dropIndex(drag, e.clientY));
    if (dropDay !== drag.dropDay) {
      markDropTarget(dropDay);
    }
    if (ids.join() !== drag.ids.join() || dropDay !== drag.dropDay) {
      setDrag({ ...drag, ids, dropDay });
    }
  };
  const endDrag = (commit: boolean) => {
    markDropTarget(null);
    const dragged = drag === null ? undefined : shown.find((x) => x.itemId === drag.id);
    if (drag !== null && commit && drag.dropDay !== null && dragged !== undefined) {
      move(dragged, drag.dropDay);
    } else if (drag !== null && commit && drag.ids.join() !== drag.startIds.join()) {
      reorder(drag.ids);
    }
    setDrag(null);
  };
  const step = (event: DayEvent, delta: -1 | 1) => {
    const ids = shown.map((x) => x.itemId);
    const to = ids.indexOf(event.itemId) + delta;
    if (to >= 0 && to < ids.length) {
      reorder(moveId(ids, event.itemId, to));
    }
  };
  // 時刻のパネルを開いている予定と、押した時刻の要素
  const [timing, setTiming] = useState<{ itemId: string; anchor: HTMLElement } | null>(null);
  const timingEvent = timing === null ? undefined : shown.find((e) => e.itemId === timing.itemId);
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
        <ul ref={listRef} className="space-y-0.5 pt-0.5">
          {rows.map((event) => {
            const color = eventColor(event, prefs);
            return (
              <li
                key={event.itemId}
                data-priority={event.priority ?? "normal"}
                style={color.style}
                // 薄い縁 … 地を白にした行どうしも見分けが付くように
                data-dragging={drag?.id === event.itemId ? "" : undefined}
                className={`flex items-stretch rounded-sm ring-1 ring-black/10 ring-inset ${color.className} ${
                  drag?.id === event.itemId ? "relative z-10 shadow-lg ring-2 ring-blue-500" : ""
                }`}
                // 題名の文字を押したら、行の動き (フォームを開く) より先に受けて編集にする
                onClickCapture={(e) => {
                  if (!inlineEdit || !(e.target instanceof Element)) {
                    return;
                  }
                  const time = e.target.closest<HTMLElement>("[data-event-time]");
                  const title = e.target.closest("[data-event-title]");
                  if (time === null && title === null) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  if (time !== null) {
                    setTiming({ itemId: event.itemId, anchor: time });
                  } else {
                    setRenaming(event.itemId);
                  }
                }}
                onKeyDown={(e) => {
                  if (inlineEdit && e.key === "F2" && renaming === null) {
                    e.preventDefault();
                    setRenaming(event.itemId);
                  }
                }}
              >
                <DragHandle
                  event={event}
                  onPointerDown={(e) => startDrag(event, e)}
                  onPointerMove={moveDrag}
                  onPointerEnd={endDrag}
                  onStep={(delta) => step(event, delta)}
                />
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
      {timing !== null && timingEvent !== undefined && (
        <TimePopover
          // 押し直した時刻・別の予定ごとに作り直す (置き場所を測り直す)
          key={timing.itemId}
          anchor={timing.anchor}
          range={rangeOf(timingEvent)}
          onChange={(range) => retime(timingEvent, range)}
          onClose={() => setTiming(null)}
        />
      )}
      {error !== null && (
        <p role="alert" className="mt-1 rounded bg-yellow-50 px-2 py-1 text-sm text-yellow-800">
          {error}
        </p>
      )}
    </div>
  );
}
