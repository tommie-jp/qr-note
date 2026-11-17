"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { DayEvent } from "../event/monthLayout";
import { hasDragStarted, isClickAfterDrag, type Point } from "../event/dragGesture";

// 日の一覧 (DayEventList) の ︙ のドラッグ (並べ替え・別の日へ移す。§1-15・§1-16)。
// DayEventList から分けた (docs/128 §3-3)

// ドラッグ中の並び。ids はいま見せている順、startIds は掴んだときの順、mids は掴んだ
// ときの各行の縦の中心 (この位置との比べで落とし先を決める。行が入れ替わっても動かない)
// dropDay … 指が別の日のマスの上にあればその日 (離すとその日へ移す。§1-16)
// start … 押した点。moved … そこから DRAG_START_PX 以上動いた (それまでは「押した」。§1-38)
export interface DragState {
  id: string;
  ids: readonly string[];
  startIds: readonly string[];
  mids: readonly number[];
  dropDay: string | null;
  start: Point;
  moved: boolean;
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

// 指を動かした先の並び。別の日のマスの上なら移す (並べ替えはしない)。でなければ一覧の中の
// 並べ替え。移す先の枠もここで付け替える。見せ方が変わらなければ null
function draggedTo(current: DragState, x: number, y: number, day: string): DragState | null {
  const dropDay = dayUnder(x, y, day);
  const ids = dropDay !== null ? current.startIds : moveId(current.startIds, current.id, dropIndex(current, y));
  if (dropDay !== current.dropDay) {
    markDropTarget(dropDay);
  }
  if (!current.moved || ids.join() !== current.ids.join() || dropDay !== current.dropDay) {
    return { ...current, ids, dropDay, moved: true };
  }
  return null;
}

// 動かして離した: 別の日のマスの上ならその日へ移し、でなければ並べ替える。
// 取り消し (pointercancel) では何もしない
function commitDrag(
  current: DragState,
  shown: readonly DayEvent[],
  move: (event: DayEvent, date: string) => void,
  reorder: (ids: readonly string[]) => void,
): void {
  const dragged = shown.find((x) => x.itemId === current.id);
  if (current.dropDay !== null && dragged !== undefined) {
    move(dragged, current.dropDay);
  } else if (current.ids.join() !== current.startIds.join()) {
    reorder(current.ids);
  }
}

export function moveId(ids: readonly string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  return [...rest.slice(0, to), id, ...rest.slice(to)];
}

interface DragHandlers {
  move: (x: number, y: number) => void;
  end: (commit: boolean, at: number) => void;
}

// 押した後の動きと離したときは、つまみではなく window で受ける (§1-31)。
// 並びが入れ替わると React が掴んだ行を DOM の中で付け替え、そのときポインタの
// キャプチャが外れる。つまみで受けていると離した知らせが届かず、移す先の枠が
// 残ったまま予定が移らなかった。
// window の受け手は掴んだときに作るので、最新の処理は ref から読む
function useWindowPointer(handlers: DragHandlers): (pointerId: number) => void {
  const handlersRef = useRef<DragHandlers>({
    move: (_x: number, _y: number) => {},
    end: (_commit: boolean, _at: number) => {},
  });
  const stopListeningRef = useRef<(() => void) | null>(null);
  const listenWindow = (pointerId: number) => {
    stopListeningRef.current?.();
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === pointerId) {
        handlersRef.current.move(e.clientX, e.clientY);
      }
    };
    const finish = (commit: boolean) => (e: PointerEvent) => {
      if (e.pointerId !== pointerId) {
        return;
      }
      stop();
      handlersRef.current.end(commit, e.timeStamp);
    };
    const onUp = finish(true);
    const onCancel = finish(false);
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      stopListeningRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    stopListeningRef.current = stop;
  };
  useEffect(() => {
    handlersRef.current = handlers;
  });
  // 掴んだまま一覧が閉じたら、window の受け手と枠を片付ける
  useEffect(
    () => () => {
      stopListeningRef.current?.();
      markDropTarget(null);
    },
    [],
  );
  return listenWindow;
}

// 掴んだときの各行の縦の中心
function rowMids(list: HTMLUListElement | null): number[] {
  const items = list === null ? [] : [...list.children];
  return items.map((li) => {
    const rect = li.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
}

// ドラッグ中の並び。window の受け手は掴んだときに作るので、最新の状態は ref からも読む
function useDragState() {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const updateDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  return { drag, dragRef, updateDrag };
}

interface EventDragOptions {
  day: string;
  shown: readonly DayEvent[];
  listRef: RefObject<HTMLUListElement | null>;
  // 動き始めたら ︙ のメニューを閉じる
  closeMenu: () => void;
  move: (event: DayEvent, date: string) => void;
  reorder: (ids: readonly string[]) => void;
}

export function useEventDrag({ day, shown, listRef, closeMenu, move, reorder }: EventDragOptions) {
  // 最後にドラッグを終えた時刻 (イベントの timeStamp、ms)。直後に届く ︙ の click でメニューを開かない
  const dragEndedAtRef = useRef<number | null>(null);
  const { drag, dragRef, updateDrag } = useDragState();
  const moveDrag = (x: number, y: number) => {
    const current = dragRef.current;
    // 押した点から少し動くまではドラッグにしない (動かずに離せばメニュー。§1-38)
    if (current === null || (!current.moved && !hasDragStarted(current.start, { x, y }))) {
      return;
    }
    if (!current.moved) {
      closeMenu();
    }
    const next = draggedTo(current, x, y, day);
    if (next !== null) {
      updateDrag(next);
    }
  };
  const endDrag = (commit: boolean, at: number) => {
    markDropTarget(null);
    const current = dragRef.current;
    updateDrag(null);
    // 動かさずに離した … 並べ替えも移しもしない (続く click がメニューを開く)
    if (current === null || !current.moved) {
      return;
    }
    dragEndedAtRef.current = at;
    if (commit) {
      commitDrag(current, shown, move, reorder);
    }
  };
  const listenWindow = useWindowPointer({ move: moveDrag, end: endDrag });
  const startDrag = (event: DayEvent, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) {
      return;
    }
    const ids = shown.map((x) => x.itemId);
    e.currentTarget.setPointerCapture(e.pointerId);
    listenWindow(e.pointerId);
    const mids = rowMids(listRef.current);
    updateDrag({ id: event.itemId, ids, startIds: ids, mids, dropDay: null, start: { x: e.clientX, y: e.clientY }, moved: false });
  };
  // ドラッグを終えた直後に届いた ︙ の click か
  const isAfterDrag = (timeStamp: number) => isClickAfterDrag(dragEndedAtRef.current, timeStamp);
  // ドラッグ中は指の位置の並びで見せる
  const rows = drag === null ? shown : drag.ids.flatMap((id) => shown.filter((event) => event.itemId === id));
  return { drag, rows, startDrag, isAfterDrag };
}
