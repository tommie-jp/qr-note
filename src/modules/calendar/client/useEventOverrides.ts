"use client";

import { useState } from "react";
import { eventSpan, jstParts } from "../event/eventTime";
import { compareDayEvents, type DayEvent } from "../event/monthLayout";
import type { TimeRange } from "../event/timeOptions";
import { saveEventDate, saveEventDone, saveEventOrder, saveEventTime, saveEventTitle, trashEvent } from "./eventDone";

// 日の一覧 (DayEventList) で直した値を、保存の応答より先に見せる控え。
// DayEventList から分けた (docs/128 §3-3)

// 時刻を変えた予定を、保存の前から一覧に見せるための値 (日付は予定の開始の日)
function withRange(event: DayEvent, range: TimeRange | null): Pick<DayEvent, "start" | "end" | "allDay"> {
  const date = jstParts(new Date(event.start)).date;
  const span = eventSpan({ date, start: range?.start ?? null, end: range?.end ?? null, until: null });
  return { start: span.start.toISOString(), end: span.end.toISOString(), allDay: span.allDay };
}

type EventFields = Partial<Pick<DayEvent, "done" | "title" | "start" | "end" | "allDay" | "order">>;
// movedTo … 別の日へ移した・removed … ゴミ箱へ移した
// (どちらも月の予定を取り直すまで、この日の一覧から隠す)
type Override = EventFields & { movedTo?: string; removed?: boolean };

const isHidden = (override: Override | undefined) =>
  override !== undefined && (override.movedTo !== undefined || override.removed === true);

const caughtUp = (event: DayEvent | undefined, override: Override) => {
  if (isHidden(override)) {
    // 取り直した一覧から消えたら追いついた
    return event === undefined;
  }
  return (
    event !== undefined &&
    (Object.keys(override) as (keyof EventFields)[]).every((key) => event[key] === override[key])
  );
};

// 上書きした値で並べ直す (済みは最後。マス目の並びと同じ)
function applyOverrides(events: readonly DayEvent[], overrides: ReadonlyMap<string, Override>): DayEvent[] {
  return events
    .filter((event) => !isHidden(overrides.get(event.itemId)))
    .map((event) => {
      const override = overrides.get(event.itemId);
      return override === undefined ? event : { ...event, ...override };
    })
    .sort(compareDayEvents);
}

// 押した「済み」・直した題名を、サーバの応答 (月の予定の取り直し) が追いつくまで
// 上書きして見せる
export function useEventOverrides(events: readonly DayEvent[]) {
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
  const remove = (event: DayEvent) => apply(event.itemId, { removed: true }, trashEvent(event.itemId));

  const shown = applyOverrides(events, overrides);
  return { shown, toggle, rename, retime, reorder, move, remove, error };
}
