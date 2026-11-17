"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import type { CalendarPrefs } from "../event/calendarPrefs";
import { holidayName } from "../event/holidays";
import { eventEndLabel, eventTimeLabel, type DayEvent } from "../event/monthLayout";
import type { TimeRange } from "../event/timeOptions";
import { DoneButton, DragHandle, TitleEditor } from "./DayRowParts";
import { EventRowMenu } from "./EventRowMenu";
import { TimePopover } from "./TimePopover";
import { useTitleLinkClicks } from "./TitleText";
import { useCalendarPrefs } from "./prefsStore";
import { eventColor } from "./priorityColor";
import { useEventDrag, moveId, type DragState } from "./useEventDrag";
import { useEventOverrides } from "./useEventOverrides";

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

// 予定の行は SaiSuke2 と同じく色の帯 (優先度の色は設定から、済みは灰。priorityColor.ts)。
// 高さは 28px (題名の 1 行 24px + 上下 2px。docs/126 §1-26 で 36px から詰めた)。
// 題名が長いときは折り返して行が縦に伸びる (時刻は縦の中央のまま)。
// 左に時刻 (1 行、終日は「終日」)、右に題名。色は行の器 (li) が持つ
export const DAY_ROW_CLASS = "flex min-h-7 min-w-0 flex-1 items-center gap-2 pr-1 text-left text-base leading-6 hover:brightness-95";

// 行の本体 (renderRow が返す、押すとフォーム・ノートを開く要素) の目印。
// ︙ のメニューの「編集」はこれを押したことにする (§1-38)
export const EVENT_ROW_ATTR = "data-event-row";

// 表の罫線 (docs/126 §1-27)。横の線だけ (一覧の上・行の下)。縦の線は引かない (§1-29)
const GRID_LINE = "border-gray-300";

// 予定のいまの時刻 (パネルの初期値)。終日は null
function rangeOf(event: DayEvent): TimeRange | null {
  const start = eventTimeLabel(event);
  return start === null ? null : { start, end: eventEndLabel(event) };
}

// メニュー・時刻のパネルを開いている予定と、押した要素
interface Anchored {
  itemId: string;
  anchor: HTMLElement;
}

// メニューの「編集」… 行の本体を押したことにする。器ごとの動き (2・3 ペインは
// 行のそばのフォーム、1 ペインはノートの予定タブ) をそのまま通る
function editFromMenu(anchor: HTMLElement): void {
  anchor.closest("li")?.querySelector<HTMLElement>(`[${EVENT_ROW_ATTR}]`)?.click();
}

// 見出しの帯 (SaiSuke2 と同じ緑)
function DayHeader({
  day,
  onAdd,
  trailing,
}: {
  day: string;
  onAdd: (button: HTMLElement) => void;
  trailing?: ReactNode;
}) {
  return (
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
  );
}

// 行で受ける操作 (どの予定の行かを第 1 引数に取る)
interface EventRowActions {
  openTime: (event: DayEvent, anchor: HTMLElement) => void;
  startRename: (event: DayEvent) => void;
  commitRename: (event: DayEvent, title: string) => void;
  cancelRename: () => void;
  startDrag: (event: DayEvent, e: React.PointerEvent<HTMLButtonElement>) => void;
  toggleMenu: (event: DayEvent, e: React.MouseEvent<HTMLButtonElement>) => void;
  step: (event: DayEvent, delta: -1 | 1) => void;
  toggleDone: (event: DayEvent) => void;
}

function makeRowActions({
  shown,
  setTiming,
  setRenaming,
  setMenu,
  isAfterDrag,
  startDrag,
  rename,
  reorder,
  toggle,
}: {
  shown: readonly DayEvent[];
  setTiming: (timing: Anchored) => void;
  setRenaming: (itemId: string | null) => void;
  setMenu: React.Dispatch<React.SetStateAction<Anchored | null>>;
  isAfterDrag: (timeStamp: number) => boolean;
  startDrag: EventRowActions["startDrag"];
  rename: (event: DayEvent, title: string) => void;
  reorder: (ids: readonly string[]) => void;
  toggle: (event: DayEvent, done: boolean) => void;
}): EventRowActions {
  return {
    openTime: (event, anchor) => setTiming({ itemId: event.itemId, anchor }),
    startRename: (event) => setRenaming(event.itemId),
    commitRename: (event, title) => {
      setRenaming(null);
      rename(event, title);
    },
    cancelRename: () => setRenaming(null),
    startDrag,
    // ︙ を押した (動かさずに離した・Enter・Space)。もう一度押すと閉じる
    toggleMenu: (event, e) => {
      if (isAfterDrag(e.timeStamp)) {
        return;
      }
      const anchor = e.currentTarget;
      setMenu((prev) => (prev?.itemId === event.itemId ? null : { itemId: event.itemId, anchor }));
    },
    step: (event, delta) => {
      const ids = shown.map((x) => x.itemId);
      const to = ids.indexOf(event.itemId) + delta;
      if (to >= 0 && to < ids.length) {
        reorder(moveId(ids, event.itemId, to));
      }
    },
    toggleDone: (event) => toggle(event, event.done !== true),
  };
}

// 題名の文字・時刻を押したら、行の動き (フォームを開く) より先に受けて編集にする
function onRowClickCapture(
  e: React.MouseEvent<HTMLLIElement>,
  event: DayEvent,
  inlineEdit: boolean,
  actions: EventRowActions,
): void {
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
    actions.openTime(event, time);
  } else {
    actions.startRename(event);
  }
}

interface EventRowProps {
  event: DayEvent;
  color: ReturnType<typeof eventColor>;
  dragging: boolean;
  inlineEdit: boolean;
  renaming: string | null;
  menuOpen: boolean;
  actions: EventRowActions;
  renderRow: (event: DayEvent) => ReactNode;
}

// 予定の 1 行 (つまみ・済み・本体)
function EventRow({ event, color, dragging, inlineEdit, renaming, menuOpen, actions, renderRow }: EventRowProps) {
  return (
    <li
      data-priority={event.priority ?? "normal"}
      style={color.style}
      // 行の下の罫線。地を白にした行どうしも見分けが付く
      data-dragging={dragging ? "" : undefined}
      className={`flex items-stretch border-b ${GRID_LINE} ${color.className} ${
        dragging ? "relative z-10 shadow-lg ring-2 ring-blue-500 ring-inset" : ""
      }`}
      // 題名の文字を押したら、行の動き (フォームを開く) より先に受けて編集にする
      onClickCapture={(e) => onRowClickCapture(e, event, inlineEdit, actions)}
      onKeyDown={(e) => {
        if (inlineEdit && e.key === "F2" && renaming === null) {
          e.preventDefault();
          actions.startRename(event);
        }
      }}
    >
      <DragHandle
        event={event}
        menuOpen={menuOpen}
        onPointerDown={(e) => actions.startDrag(event, e)}
        onClick={(e) => actions.toggleMenu(event, e)}
        onStep={(delta) => actions.step(event, delta)}
      />
      <DoneButton event={event} onToggle={() => actions.toggleDone(event)} />
      {renaming === event.itemId ? (
        <TitleEditor
          event={event}
          onCommit={(title) => actions.commitRename(event, title)}
          onCancel={actions.cancelRename}
        />
      ) : (
        renderRow(event)
      )}
    </li>
  );
}

// 予定の行の並び
function EventRows({
  listRef,
  rows,
  drag,
  prefs,
  rowProps,
  menuItemId,
}: {
  listRef: RefObject<HTMLUListElement | null>;
  rows: readonly DayEvent[];
  drag: DragState | null;
  prefs: CalendarPrefs;
  rowProps: Pick<EventRowProps, "inlineEdit" | "renaming" | "actions" | "renderRow">;
  menuItemId: string | undefined;
}) {
  return (
    <ul ref={listRef} className={`border-t ${GRID_LINE}`}>
      {rows.map((event) => (
        <EventRow
          key={event.itemId}
          event={event}
          color={eventColor(event, prefs)}
          // 掴んだ印は動き始めてから出す (押しただけならメニュー。§1-38)
          dragging={drag?.id === event.itemId && drag.moved}
          menuOpen={menuItemId === event.itemId}
          {...rowProps}
        />
      ))}
    </ul>
  );
}

// 時刻のパネル・︙ のメニュー・保存の失敗
function DayEventOverlays({
  shown,
  timing,
  menu,
  error,
  onCloseTiming,
  onCloseMenu,
  retime,
  remove,
}: {
  shown: readonly DayEvent[];
  timing: Anchored | null;
  menu: Anchored | null;
  error: string | null;
  onCloseTiming: () => void;
  onCloseMenu: () => void;
  retime: (event: DayEvent, range: TimeRange | null) => void;
  remove: (event: DayEvent) => void;
}) {
  const timingEvent = timing === null ? undefined : shown.find((e) => e.itemId === timing.itemId);
  const menuEvent = menu === null ? undefined : shown.find((e) => e.itemId === menu.itemId);
  return (
    <>
      {timing !== null && timingEvent !== undefined && (
        <TimePopover
          // 押し直した時刻・別の予定ごとに作り直す (置き場所を測り直す)
          key={timing.itemId}
          anchor={timing.anchor}
          range={rangeOf(timingEvent)}
          onChange={(range) => retime(timingEvent, range)}
          onClose={onCloseTiming}
        />
      )}
      {menu !== null && menuEvent !== undefined && (
        <EventRowMenu
          // 別の予定の ︙ を押したら作り直す (置き場所を測り直す)
          key={menu.itemId}
          title={menuEvent.title || "(無題)"}
          anchor={menu.anchor}
          onEdit={() => editFromMenu(menu.anchor)}
          onDelete={() => remove(menuEvent)}
          onClose={onCloseMenu}
        />
      )}
      {error !== null && (
        <p role="alert" className="mt-1 rounded bg-yellow-50 px-2 py-1 text-sm text-yellow-800">
          {error}
        </p>
      )}
    </>
  );
}

interface DayEventListProps {
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
}: DayEventListProps) {
  const { shown, toggle, rename, retime, reorder, move, remove, error } = useEventOverrides(events);
  const rootRef = useRef<HTMLDivElement>(null);
  useTitleLinkClicks(rootRef);
  const listRef = useRef<HTMLUListElement>(null);
  // ︙ のメニューを開いている予定と、押した ︙ (§1-38)
  const [menu, setMenu] = useState<Anchored | null>(null);
  const closeMenu = () => setMenu(null);
  // rows … ドラッグ中は指の位置の並び
  const { drag, rows, startDrag, isAfterDrag } = useEventDrag({ day, shown, listRef, closeMenu, move, reorder });
  // 時刻のパネルを開いている予定と、押した時刻の要素
  const [timing, setTiming] = useState<Anchored | null>(null);
  // 題名を直している予定
  const [renaming, setRenaming] = useState<string | null>(null);
  const { prefs } = useCalendarPrefs();
  const actions = makeRowActions({ shown, setTiming, setRenaming, setMenu, isAfterDrag, startDrag, rename, reorder, toggle });
  return (
    <div ref={rootRef}>
      <DayHeader day={day} onAdd={onAdd} trailing={trailing} />
      {events.length === 0 ? (
        <p className="px-2 py-2 text-base text-gray-500">{loading ? "読み込み中…" : "予定はありません"}</p>
      ) : (
        <EventRows
          listRef={listRef}
          rows={rows}
          drag={drag}
          prefs={prefs}
          rowProps={{ inlineEdit, renaming, actions, renderRow }}
          menuItemId={menu?.itemId}
        />
      )}
      <DayEventOverlays
        shown={shown}
        timing={timing}
        menu={menu}
        error={error}
        onCloseTiming={() => setTiming(null)}
        onCloseMenu={closeMenu}
        retime={retime}
        remove={remove}
      />
    </div>
  );
}
