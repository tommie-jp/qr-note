"use client";

import { useCallback, useRef, useState } from "react";
import { useKeyboardInset } from "@/lib/client/keyboardInset";
import { eventEndLabel, eventTimeLabel, type DayEvent } from "../event/monthLayout";
import { TitleText } from "./TitleText";

// 日の一覧 (DayEventList) の 1 行を組む小さな部品。DayEventList から分けた (docs/128 §3-3)

// 時刻は先頭の 0 を落とす (09:30 → 9:30)
const shortTime = (time: string) => time.replace(/^0/, "");

// 時刻は 1 行 (「10:00 ~ 11:00」)。終日は「終日」。押すと時刻のパネル (data-event-time)
function TimeLabel({ event }: { event: DayEvent }) {
  const start = eventTimeLabel(event);
  const end = eventEndLabel(event);
  return (
    <span data-event-time="" className={`flex w-20 shrink-0 cursor-pointer items-center justify-center self-stretch text-xs leading-6 whitespace-nowrap tabular-nums opacity-90`}>
      {start === null ? "終日" : `${shortTime(start)} ~ ${end === null ? "" : shortTime(end)}`}
    </span>
  );
}

// 済みの予定は題名に取り消し線を引く (マス目と同じ)。
// 題名の文字 (data-event-title) を押すとインライン編集 (DayEventList)。文字の幅だけを
// 的にし、行の残り (時刻・余白) は器の動き (フォーム・ノートを開く) に残す。
// 題名の中の URL は押すとブラウザで開く (TitleText。§1-37)
export function DayRowContent({ event }: { event: DayEvent }) {
  return (
    <>
      <TimeLabel event={event} />
      {/* 長い題名は省略せず折り返す (英数字の長い連なりも途中で折る)。複数行の時は上下に 2px 空ける */}
      <span className="min-w-0 flex-1 py-0.5 wrap-anywhere">
        <span data-event-title="" className={`cursor-text ${event.done ? "line-through" : ""}`}>
          <TitleText title={event.title || "(無題)"} />
        </span>
      </span>
    </>
  );
}

// 題名の欄のキー。Enter で確定、Esc で取り消し
function onTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, finish: (commit: boolean) => void): void {
  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
    e.preventDefault();
    finish(true);
  } else if (e.key === "Escape") {
    // ペインの Esc (閉じる) まで届かせない
    e.stopPropagation();
    finish(false);
  }
}

// 題名のインライン編集の欄。Enter・外を押すで確定、Esc で取り消し。
// 空にしたら元のまま (題名の無い予定はマス目で見分けが付かない)
export function TitleEditor({
  event,
  onCommit,
  onCancel,
}: {
  event: DayEvent;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(event.title);
  // 打っている間は下のペインをキーボードの上へ浮かせ、欄をペインの中で見える所へ送る
  // (iPhone はキーボードで画面を縮めず、下端のペインがその下に隠れた。§1-33)
  const inputRef = useRef<HTMLInputElement>(null);
  const keepVisible = useCallback(() => {
    inputRef.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useKeyboardInset(true, keepVisible);
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
    <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 pr-1">
      <TimeLabel event={event} />
      <input
        ref={inputRef}
        aria-label="題名"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => onTitleKeyDown(e, finish)}
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
// 動かさずに押すとメニュー (編集・削除。§1-38)。Enter・Space でも開く。
// touch-none … 指でなぞったときに一覧ごとスクロールさせない。
// 押した後の動きと離したときは window で受ける (useEventDrag の startDrag。§1-31)
export function DragHandle({
  event,
  menuOpen,
  onPointerDown,
  onClick,
  onStep,
}: {
  event: DayEvent;
  menuOpen: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onStep: (delta: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${event.title || "(無題)"} の操作 (ドラッグで並べ替え)`}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      title="押すとメニュー・ドラッグで並べ替える (↑ ↓ でも)"
      data-drag-handle=""
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onStep(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      className={`flex w-6 shrink-0 cursor-grab touch-none items-center justify-center self-stretch text-lg leading-none select-none active:cursor-grabbing`}
    >
      <span className="opacity-60">︙</span>
    </button>
  );
}

// 済みの釦。丸の中に ✓。押した側の値はすぐ見せ、保存は裏で行う (DayEventList)。
// 未済の丸は灰の縁に白の中身 — 地の色 (設定で白にもできる) に溶けないように
export function DoneButton({ event, onToggle }: { event: DayEvent; onToggle: () => void }) {
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
