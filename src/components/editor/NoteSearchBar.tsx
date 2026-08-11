"use client";

import { useEffect, useRef } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClearIcon,
  ReplaceIcon,
} from "@/components/MenuIcons";
import {
  COMPACT_ICON_BUTTON_CLASS,
  COMPACT_INPUT_CLASS,
  COMPACT_SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import type { NoteSearchNote } from "./noteSearch";

// ノート内検索・置換の帯 (docs/76-ノート内検索計画.md §2)。
//
// 下部バーの差し込み口へ portal されて、開いている間は編集ツールバーと
// **入れ替わる**。並べると帯が 2 段になり、狭い画面で本文が潰れるため。
//
// 状態は持たない (MemoEditorInner が持つ) — 検索語を CodeMirror へ渡すのも
// 一致を数えるのも向こうの仕事で、ここは受け取って描くだけ。EditToolbar と
// 同じ役割分担。

// 押せる的は 36px 角 (検索画面の COMPACT_* と同寸)。下部バーの他のボタンより
// 小さいのは、1 行に入力欄と 5 つの的を並べるため — 320px 幅でも入力欄に
// 120px 残る。狙って押す物ではあるが、押し間違えても隣は「前/次」で実害が薄い
const ICON_BUTTON = `${COMPACT_ICON_BUTTON_CLASS} shrink-0`;

// 大小の区別トグル。押されている間だけ青くする (下部バーの選択スロットと
// 同じ作法 — aria-pressed だけでは見た目に出ない)
const CASE_TOGGLE_ON = `${ICON_BUTTON} border-blue-500 bg-blue-50 text-blue-700`;

export interface NoteSearchBarProps {
  search: string;
  replace: string;
  caseSensitive: boolean;
  showReplace: boolean;
  count: { total: number; current: number };
  note: NoteSearchNote | null;
  onSearchChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onToggleCase: () => void;
  onToggleReplace: () => void;
  onFindNext: () => void;
  onFindPrev: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onUndo: () => void;
  onClose: () => void;
}

// 件数の文字。打ち始める前 (検索語が空) は何も言わない — 0 件と出すと
// 「この語は無い」と読めてしまう
function countLabel(search: string, total: number, current: number): string {
  if (search === "") {
    return "";
  }
  if (total === 0) {
    return "0 件";
  }
  // 本文を直した直後は一致の上から外れる。番号だけ「-」にして総数は残す
  return `${current === 0 ? "-" : current}/${total}`;
}

export function NoteSearchBar({
  search,
  replace,
  caseSensitive,
  showReplace,
  count,
  note,
  onSearchChange,
  onReplaceChange,
  onToggleCase,
  onToggleReplace,
  onFindNext,
  onFindPrev,
  onReplaceOne,
  onReplaceAll,
  onUndo,
  onClose,
}: NoteSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMatch = count.total > 0;

  // 開いたら検索窓へ入る。**全選択**するのは、前の検索語を復元して開くため
  // (同じ語を続けて探すことが多い一方、別の語を打つときは 1 文字目で消えて
  // ほしい)。autoFocus 属性ではなく effect にするのは select() が要るから
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Enter = 次、Shift+Enter = 前、Escape = 閉じる。
  // **IME の変換確定の Enter を拾わない** — 変換候補を選んだだけで次の一致へ
  // 飛ぶと、日本語を打つたびに本文が動く (keyCode 229 は変換中の合図)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      onFindPrev();
    } else {
      onFindNext();
    }
  };

  return (
    // 下部バーの差し込み口 (flex) の中で全幅を取る。py-1 … 入力欄 (36px) が
    // 帯の高さいっぱいに詰まって窮屈に見えないように
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1">
      {/* 置換の結果・断りは帯の**上**に出す。帯の中に行を足すと、
          キーボードが出ている狭い画面でさらに本文が削られる。
          fixed の下部バーが囲みなので、absolute の基準はその帯になる */}
      {note && (
        <div className="absolute inset-x-0 bottom-full flex justify-center px-3 pb-2">
          <p
            role="status"
            className="flex items-center gap-3 rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg"
          >
            {note.text}
            {note.undo && (
              <button
                type="button"
                onClick={onUndo}
                className="font-semibold text-blue-300 underline underline-offset-2"
              >
                元に戻す
              </button>
            )}
          </p>
        </div>
      )}

      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          // 変換を確定するまで検索しない、という作りにはしていない。
          // 打った端から件数が動くほうが「その語が在るか」を早く掴める
          placeholder="ノート内を検索"
          aria-label="ノート内を検索"
          autoComplete="off"
          // 送信のある form の中に portal されているので、Enter で
          // 更新が走らないよう handleKeyDown で必ず preventDefault する
          enterKeyHint="search"
          className={`min-w-0 flex-1 ${COMPACT_INPUT_CLASS}`}
        />
        <button
          type="button"
          onClick={onToggleCase}
          aria-pressed={caseSensitive}
          aria-label="大文字と小文字を区別する"
          className={caseSensitive ? CASE_TOGGLE_ON : ICON_BUTTON}
        >
          <span aria-hidden className="text-xs font-semibold">
            Aa
          </span>
        </button>
        {/* 件数。tabular-nums で桁が変わっても左右に跳ねない。
            0 件だけ赤 — 打ち間違いに気づける唯一の手がかり */}
        <span
          aria-live="polite"
          className={`w-12 shrink-0 text-center text-xs tabular-nums ${
            search !== "" && count.total === 0 ? "text-red-600" : "text-gray-500"
          }`}
        >
          {countLabel(search, count.total, count.current)}
        </span>
        <button
          type="button"
          onClick={onFindPrev}
          disabled={!hasMatch}
          aria-label="前の一致へ"
          className={ICON_BUTTON}
        >
          <ChevronUpIcon />
        </button>
        <button
          type="button"
          onClick={onFindNext}
          disabled={!hasMatch}
          aria-label="次の一致へ"
          className={ICON_BUTTON}
        >
          <ChevronDownIcon />
        </button>
        <button
          type="button"
          onClick={onToggleReplace}
          aria-pressed={showReplace}
          aria-label="置換"
          className={showReplace ? CASE_TOGGLE_ON : ICON_BUTTON}
        >
          <ReplaceIcon />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="検索を閉じる"
          className={ICON_BUTTON}
        >
          <ClearIcon />
        </button>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={replace}
            onChange={(e) => onReplaceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="置換後の文字"
            aria-label="置換後の文字"
            autoComplete="off"
            className={`min-w-0 flex-1 ${COMPACT_INPUT_CLASS}`}
          />
          <button
            type="button"
            onClick={onReplaceOne}
            disabled={!hasMatch}
            className={`${COMPACT_SECONDARY_BUTTON_CLASS} shrink-0`}
          >
            置換
          </button>
          {/* 件数を書いておく。押す前に規模が判り、押した後に何件だったかを
              知らせと突き合わせられる (docs/76 §5-1) */}
          <button
            type="button"
            onClick={onReplaceAll}
            disabled={!hasMatch}
            className={`${COMPACT_SECONDARY_BUTTON_CLASS} shrink-0`}
          >
            すべて ({count.total})
          </button>
        </div>
      )}
    </div>
  );
}
