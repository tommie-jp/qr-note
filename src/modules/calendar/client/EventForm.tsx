"use client";

import { useId, useState } from "react";
import type { Item } from "@/generated/prisma/client";
import { isItemDto } from "@/lib/api/itemDto";
import { trashItemsAction } from "@/lib/client/actions";
import { noteWritten } from "@/lib/client/invalidate";
import { noteCache } from "@/lib/client/noteStore";
import { formatBase } from "@/lib/editor/saveBase";
import { parseStoredProps } from "@/lib/markdown/props";
import { applyEvent, eventTitleOf, newEventMemo, type EventInput } from "../event/eventMemo";
import { jstToday } from "../event/monthLayout";
import { eventPriority, normalizeDate, normalizeTime, parseEvent } from "../event/parseEvent";
import { invalidateCalendar } from "./calendarStore";
import { DateFields, FormStatus, TimeFields, TitleField, type Draft, type Status } from "./EventFormFields";
import { putMemo } from "./saveMemo";

export interface EventFormProps {
  itemId: string;
  // 未登録のノートは null (保存で新規作成になる)
  item: Item | null;
  // 新しい予定の日付 (URL の ?date=)
  initialDate: string | null;
  // いま見ている検索式。新しい予定に付けるタグを決める
  query: string;
  // 全画面 (1 ペイン) で開いているか。新しい予定を保存したら月へ戻る
  fullscreen: boolean;
  // 保存・ゴミ箱へ移した後に呼ぶ (日の予定から浮かせて開いたフォームを閉じる)
  onDone?: () => void;
}

function initialDraft(item: Item | null, initialDate: string | null): Draft {
  const props = item === null ? null : parseStoredProps(item.props);
  const fields = props === null ? null : parseEvent(props);
  const date = fields?.date ?? (initialDate !== null ? normalizeDate(initialDate) : null) ?? jstToday();
  return {
    title: item === null ? "" : eventTitleOf(item.memo),
    date,
    allDay: fields === null ? true : fields.start === null,
    start: fields?.start ?? "10:00",
    end: fields?.end ?? "",
    priority: props === null ? "normal" : eventPriority(props),
  };
}

// 入力を検める。題名が無い・時刻が読めない・終わりが始まり以前、を断る
function toInput(draft: Draft): EventInput | string {
  const title = draft.title.trim();
  if (title === "") {
    return "題名を入れてください";
  }
  if (normalizeDate(draft.date) === null) {
    return "日付を入れてください";
  }
  if (draft.allDay) {
    return { title, date: draft.date, start: null, end: null, priority: draft.priority };
  }
  const start = normalizeTime(draft.start);
  if (start === null) {
    return "開始の時刻を入れてください";
  }
  const end = draft.end === "" ? null : normalizeTime(draft.end);
  if (draft.end !== "" && (end === null || end <= start)) {
    return "終了は開始より後の時刻にしてください";
  }
  return { title, date: draft.date, start, end, priority: draft.priority };
}

// 下書きと保存の状態。直したら「保存しました」を消す
function useEventDraft(item: Item | null, initialDate: string | null) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(item, initialDate));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const update = (patch: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    if (status.kind === "saved") {
      setStatus({ kind: "idle" });
    }
  };
  return { draft, status, setStatus, update };
}

// 保存・読み直し・ゴミ箱へ
function formActions(
  { itemId, item, query, fullscreen, onDone }: EventFormProps,
  draft: Draft,
  setStatus: (status: Status) => void,
) {
  const isNew = item === null;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = toInput(draft);
    if (typeof input === "string") {
      setStatus({ kind: "error", message: input });
      return;
    }
    setStatus({ kind: "saving" });
    const memo = item === null ? newEventMemo(input, query) : applyEvent(item.memo, input);
    const result = await putMemo(itemId, memo, formatBase(item?.updatedAt ?? null));
    if (result.kind !== "saved") {
      // 入力は消さない (打ち直しにさせない)
      setStatus(result);
      return;
    }
    noteWritten(itemId, isItemDto(result.dto) ? result.dto : undefined);
    invalidateCalendar();
    if (isNew && fullscreen) {
      // 全画面で足したときは月へ戻る (日をタップ → 打つ → 追加 → 月)
      window.history.back();
      return;
    }
    if (onDone !== undefined) {
      onDone();
      return;
    }
    setStatus({ kind: "saved" });
  };

  const reload = () => {
    setStatus({ kind: "idle" });
    void noteCache.load(itemId, { force: true });
  };

  const trash = async () => {
    const form = new FormData();
    form.append("itemId", itemId);
    await trashItemsAction(form);
    invalidateCalendar();
    onDone?.();
  };
  return { save, reload, trash };
}

// 「予定」タブの中身 (docs/126 §1-4・§1-5)。本文をテキストで直させず、
// 題名と日時だけをフォームで直す。保存は本文の決まった所だけを書き換える
// (applyEvent)。新しい予定 (未登録のノート) もここで作る
export default function EventForm(props: EventFormProps) {
  const { item, initialDate } = props;
  const { draft, status, setStatus, update } = useEventDraft(item, initialDate);
  const id = useId();
  const isNew = item === null;
  const { save, reload, trash } = formActions(props, draft, setStatus);

  return (
    <form onSubmit={save} className="space-y-3 rounded border border-gray-300 bg-white p-3" aria-label="予定">
      <TitleField id={id} draft={draft} update={update} isNew={isNew} />
      <DateFields id={id} draft={draft} update={update} />
      {!draft.allDay && <TimeFields id={id} draft={draft} update={update} />}

      <FormStatus status={status} onReload={reload} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="min-h-10 rounded bg-blue-600 px-4 font-medium text-white active:bg-blue-700 disabled:opacity-50"
        >
          {isNew ? "追加" : "保存"}
        </button>
        <span className="flex-1" />
        {!isNew && item.deletedAt === null && (
          <button type="button" onClick={() => void trash()} className="min-h-10 rounded px-3 text-sm text-red-700 hover:bg-red-50">
            ゴミ箱へ
          </button>
        )}
      </div>
      {isNew && <p className="text-xs text-gray-500">「追加」を押すとノートが作られます。</p>}
    </form>
  );
}
