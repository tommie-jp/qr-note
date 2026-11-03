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
import { normalizeDate, normalizeTime, parseEvent } from "../event/parseEvent";
import { invalidateCalendar } from "./calendarStore";

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

interface Draft {
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
}

function initialDraft(item: Item | null, initialDate: string | null): Draft {
  const fields = item === null ? null : parseEvent(parseStoredProps(item.props));
  const date = fields?.date ?? (initialDate !== null ? normalizeDate(initialDate) : null) ?? jstToday();
  return {
    title: item === null ? "" : eventTitleOf(item.memo),
    date,
    allDay: fields === null ? true : fields.start === null,
    start: fields?.start ?? "10:00",
    end: fields?.end ?? "",
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
    return { title, date: draft.date, start: null, end: null };
  }
  const start = normalizeTime(draft.start);
  if (start === null) {
    return "開始の時刻を入れてください";
  }
  const end = draft.end === "" ? null : normalizeTime(draft.end);
  if (draft.end !== "" && (end === null || end <= start)) {
    return "終了は開始より後の時刻にしてください";
  }
  return { title, date: draft.date, start, end };
}

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string; reload?: boolean };

const CONFLICT_MESSAGES: Record<string, string> = {
  conflict: "別の画面でこのノートが書き換えられています。読み直してからもう一度保存してください。",
  exists: "このノートは別の画面で先に作られています。読み直してからもう一度保存してください。",
  missing: "このノートは削除されています。",
};

// 本文を保存する。409 は「いまのサーバの版」が違う (docs/87)
async function putMemo(itemId: string, memo: string, base: string): Promise<Status & { dto?: unknown }> {
  let response: Response;
  try {
    response = await fetch(`/api/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memo, base, checkpoint: false }),
    });
  } catch {
    return { kind: "error", message: "通信できませんでした。電波の届く所でもう一度お試しください" };
  }
  if (response.status === 401) {
    window.location.reload();
    return { kind: "error", message: "ログインが必要です" };
  }
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: { item?: unknown; state?: { kind?: string } }; error?: unknown }
    | null;
  if (response.status === 409) {
    const kind = body?.data?.state?.kind ?? "conflict";
    return { kind: "error", message: CONFLICT_MESSAGES[kind] ?? CONFLICT_MESSAGES.conflict, reload: kind !== "missing" };
  }
  if (!response.ok || body?.success !== true) {
    const message = typeof body?.error === "string" ? body.error : `保存できませんでした (${response.status})`;
    return { kind: "error", message };
  }
  return { kind: "saved", dto: body.data?.item };
}

const FIELD = "min-h-10 rounded border border-gray-300 px-2";

// 「予定」タブの中身 (docs/126 §1-4・§1-5)。本文をテキストで直させず、
// 題名と日時だけをフォームで直す。保存は本文の決まった所だけを書き換える
// (applyEvent)。新しい予定 (未登録のノート) もここで作る
export default function EventForm({ itemId, item, initialDate, query, fullscreen, onDone }: EventFormProps) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(item, initialDate));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const id = useId();
  const isNew = item === null;
  const update = (patch: Partial<Draft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    if (status.kind === "saved") {
      setStatus({ kind: "idle" });
    }
  };

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

  return (
    <form onSubmit={save} className="space-y-3 rounded border border-gray-300 bg-white p-3" aria-label="予定">
      <div className="space-y-1">
        <label htmlFor={`${id}-title`} className="block text-sm text-gray-600">
          題名
        </label>
        <input
          id={`${id}-title`}
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          // 新しい予定は日をタップした直後なので、すぐ打てるようにする
          autoFocus={isNew}
          enterKeyHint="done"
          className={`${FIELD} w-full`}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-date`} className="block text-sm text-gray-600">
            日付
          </label>
          <input
            id={`${id}-date`}
            type="date"
            value={draft.date}
            onChange={(e) => update({ date: e.target.value })}
            className={FIELD}
          />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.allDay} onChange={(e) => update({ allDay: e.target.checked })} className="size-5" />
          終日
        </label>
      </div>
      {!draft.allDay && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor={`${id}-start`} className="block text-sm text-gray-600">
              開始
            </label>
            <input
              id={`${id}-start`}
              type="time"
              value={draft.start}
              onChange={(e) => update({ start: e.target.value })}
              className={FIELD}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-end`} className="block text-sm text-gray-600">
              終了 (省略で 1 時間)
            </label>
            <input
              id={`${id}-end`}
              type="time"
              value={draft.end}
              onChange={(e) => update({ end: e.target.value })}
              className={FIELD}
            />
          </div>
        </div>
      )}

      {status.kind === "error" && (
        <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          {status.message}{" "}
          {status.reload && (
            <button type="button" onClick={reload} className="underline">
              読み直す
            </button>
          )}
        </p>
      )}
      {status.kind === "saved" && (
        <p role="status" className="text-sm text-green-700">
          保存しました
        </p>
      )}

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
