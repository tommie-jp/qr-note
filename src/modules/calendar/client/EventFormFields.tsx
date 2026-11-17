"use client";

import type { EventPriority } from "../event/parseEvent";
import type { SaveResult } from "./saveMemo";

// 予定のフォーム (EventForm) の欄。EventForm から分けた (docs/128 §3-3)

export interface Draft {
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  priority: EventPriority;
}

export type Status = SaveResult | { kind: "idle" } | { kind: "saving" };

const PRIORITY_OPTIONS: readonly { value: EventPriority; label: string }[] = [
  { value: "high", label: "高い" },
  { value: "normal", label: "標準" },
  { value: "low", label: "低い" },
];

const FIELD = "min-h-10 rounded border border-gray-300 px-2";

interface FieldsProps {
  // 欄の id の頭 (useId)
  id: string;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
}

export function TitleField({ id, draft, update, isNew }: FieldsProps & { isNew: boolean }) {
  return (
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
  );
}

// 日付・優先度・終日
export function DateFields({ id, draft, update }: FieldsProps) {
  return (
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
      <div className="space-y-1">
        <label htmlFor={`${id}-priority`} className="block text-sm text-gray-600">
          優先度
        </label>
        <select
          id={`${id}-priority`}
          value={draft.priority}
          onChange={(e) => update({ priority: e.target.value as EventPriority })}
          className={`${FIELD} bg-white`}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.allDay} onChange={(e) => update({ allDay: e.target.checked })} className="size-5" />
        終日
      </label>
    </div>
  );
}

// 開始・終了の時刻 (終日でないときだけ)
export function TimeFields({ id, draft, update }: FieldsProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-start`} className="block text-sm text-gray-600">
          開始
        </label>
        <input
          id={`${id}-start`}
          type="time"
          // 15 分刻み (iPhone の時刻の輪は step を守らないが、PC の欄は守る)
          step={900}
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
          // 15 分刻み (iPhone の時刻の輪は step を守らないが、PC の欄は守る)
          step={900}
          value={draft.end}
          onChange={(e) => update({ end: e.target.value })}
          className={FIELD}
        />
      </div>
    </div>
  );
}

// 保存の失敗・済んだの知らせ
export function FormStatus({ status, onReload }: { status: Status; onReload: () => void }) {
  return (
    <>
      {status.kind === "error" && (
        <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          {status.message}{" "}
          {status.reload && (
            <button type="button" onClick={onReload} className="underline">
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
    </>
  );
}
