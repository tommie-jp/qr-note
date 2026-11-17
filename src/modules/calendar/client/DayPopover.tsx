"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { newItemId } from "@/lib/items/itemId";
import { navigate } from "@/lib/client/navigation";
import type { DayEvent } from "../event/monthLayout";
import { placePopover, type Placement } from "../event/placePopover";
import { eventNoteHref } from "./calendarUrl";
import { DAY_ROW_CLASS, DayEventList, dayLabel } from "./DayEventList";
import { DayRowContent } from "./DayRowParts";
import { useDismissOnOutside } from "./useDismissOnOutside";

// マスの横に置く。右に出し、はみ出すなら左、縦は画面に収まるようずらす (placePopover)。
// 中身 (events・loading) が変わったら置き直す。マス目が送られたら閉じる (onClose)
function usePopoverPlacement(
  ref: RefObject<HTMLDivElement | null>,
  anchor: HTMLElement,
  events: readonly DayEvent[],
  loading: boolean,
  onClose: () => void,
): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);

  const place = useCallback(() => {
    const box = ref.current;
    if (box === null) {
      return;
    }
    // 測る前に縮めていた高さを外して、中身の本来の高さで測る
    box.style.maxHeight = "";
    setPlacement(
      placePopover(
        anchor.getBoundingClientRect(),
        { width: box.offsetWidth, height: box.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor, ref]);

  // 描いた直後に測って置く (置く前の 1 フレームを見せない)。中身が変わったら置き直す
  useLayoutEffect(place, [place, events, loading]);

  // 画面の大きさが変わったら置き直す。マス目が送られたら (ペインの中の
  // スクロール) マスから離れて見えるので閉じる
  useEffect(() => {
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) {
        onClose();
      }
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [place, onClose, ref]);
  return placement;
}

interface DayPopoverProps {
  day: string;
  // 選んだマスの要素 (位置を測る)
  anchor: HTMLElement;
  events: readonly DayEvent[];
  // 月の予定がまだ届いていない (「予定はありません」と言わない)
  loading: boolean;
  query: string;
  month: string;
  onClose: () => void;
}

// 1 ペインで、選んだ日の予定と「+」をマスの横に浮かせて出す (docs/126 §1-6)。
// 2・3 ペインは下のペインに出す (DayPane)。
// 右に出し、はみ出すなら左、縦は画面に収まるようずらす (placePopover)。
//
// **body へ portal する。** 検索結果の器は transform を持つことがあり、その中の
// fixed は器に縛られる。横スクロールの帯 (overflow) にも切り取られる
// (docs/86 §4-13 と同じ罠)。
//
// 予定を押すとノートの「予定」タブが開く (端末で開く印 data-client-note。
// 2・3 ペインは右のペイン、1 ペインは全画面)。押したら閉じる
export function DayPopover({ day, anchor, events, loading, query, month, onClose }: DayPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const placement = usePopoverPlacement(ref, anchor, events, loading, onClose);

  // 外を押す・Esc で閉じる。マスを押したときは閉じない (マス目の側が別の日に替える)
  useDismissOnOutside(ref, anchor, onClose, "[data-day]");

  // 番号は押したときに振る (描くたびに振ると、開いた後で番号が変わる)
  const addEvent = () => {
    onClose();
    navigate(eventNoteHref(newItemId(), query, month, day));
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${dayLabel(day)} の予定`}
      data-day-popover=""
      style={
        placement === null
          ? { left: 0, top: 0, visibility: "hidden" }
          : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
      }
      className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded border border-gray-300 bg-white shadow-lg"
    >
      <DayEventList
        day={day}
        events={events}
        loading={loading}
        onAdd={addEvent}
        renderRow={(event) => (
          <Link
            href={eventNoteHref(event.itemId, query, month)}
            // 検索画面では端末で開く印 (docs/123 §12。lib/client/clientNoteNav.ts)
            data-client-note=""
            // ︙ のメニューの「編集」はこれを押す (DayEventList の EVENT_ROW_ATTR)
            data-event-row=""
            onClick={onClose}
            className={DAY_ROW_CLASS}
          >
            <DayRowContent event={event} />
          </Link>
        )}
      />
    </div>,
    document.body,
  );
}
