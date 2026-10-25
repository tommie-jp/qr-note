"use client";

import { useRef, useState } from "react";
import { ClipboardDownIcon, ClipboardUpIcon, ImportIcon } from "@/components/icons";
import { HEADER_MENU_ITEM_CLASS, HEADER_MENU_ROW_CLASS } from "@/components/ui";
import { hasDroppedFiles } from "@/lib/editor/dropFiles";
import { SERVER_CLIPBOARD_DATA_URL } from "@/lib/clipboard/serverClipboard";
import {
  agoLabel,
  type ClipboardSlotMeta,
  isPasteable,
  slotFileName,
  slotLabel,
} from "@/lib/clipboard/slot";

// ハンバーガーメニューの「サーバへコピー」「サーバからペースト」の表示部
// (docs/114-サーバクリップボード計画.md §3)。
//
// 状態は持たない。持ち主は ServerClipboardMenuItems (+ useServerClipboard) で、
// 状態ごとの描画をここで固定する。jsdom が無いので、押す流れの確認は
// lib/clipboard/serverClipboard.test.ts と E2E に任せ、描き分けだけをここで見る。

export type ServerClipboardBusy = "send" | "file" | "receive" | "clear" | null;

export interface ServerClipboardNotice {
  readonly tone: "ok" | "error";
  readonly text: string;
}

export interface ServerClipboardViewProps {
  // undefined … 読み込み中。null … 枠が無い (または期限切れ)
  readonly slot: ClipboardSlotMeta | null | undefined;
  readonly loadFailed: boolean;
  readonly busy: ServerClipboardBusy;
  readonly notice: ServerClipboardNotice | null;
  // 「3 分前」を数える基準。枠を読んだ時刻を渡す (描画のたびに new Date() しない)
  readonly now: Date;
  readonly onSend: () => void;
  readonly onSendFile: (file: File) => void;
  // メニューへドロップされたファイル。複数・空の扱いは呼ぶ側 (pickDroppedFile)
  readonly onDropFiles: (files: File[]) => void;
  readonly onReceive: () => void;
  readonly onClear: () => void;
}

// 押せる行 (HEADER_MENU_ITEM_CLASS) の押せない見た目。hover の灰色を殺さないと、
// 押せないのに反応が返って押し損ねたように見える
const ROW_DISABLED_CLASS =
  "disabled:opacity-60 disabled:hover:bg-transparent disabled:active:bg-transparent";

const DESCRIPTION =
  "どれも 10 分で消えます。送るときはクリップボードの読み取りを許可してください。" +
  "動画・PDF などは「ファイルを選んで送る」か、ファイルをここへドロップして送れます";

// ファイルをドラッグしてきている間の見た目。点線の枠でここが受け皿だと示す
const DRAGGING_CLASS = "rounded outline-2 outline-dashed outline-sky-500 bg-sky-50";

// ファイル選択で受ける形式。写真・動画・音声・PDF・テキストの添付と同じ範囲。
// type が空で来る形式 (Windows 以外の HEIC・.md など) のため、拡張子でも許す。
// 最終的な判定はサーバが中身で行う (api/clipboard/data)
const FILE_ACCEPT = [
  "image/*",
  "video/*",
  "audio/*",
  "application/pdf",
  "text/*",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".md",
  ".csv",
  ".txt",
  ".s1p",
  ".s2p",
].join(",");

export function ServerClipboardView({
  slot,
  loadFailed,
  busy,
  notice,
  now,
  onSend,
  onSendFile,
  onDropFiles,
  onReceive,
  onClear,
}: ServerClipboardViewProps) {
  const hasSlot = slot !== undefined && slot !== null;
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={dragging ? DRAGGING_CLASS : undefined}
      // 行の中を押してもメニューを閉じない。結果 (✓ 送りました) を見せる場所が
      // この行の下なので、閉じると見えない (PhotoMetaMenuItem と同じ)
      onClick={(event) => event.stopPropagation()}
      // ファイルのドロップ。**ファイルのときだけ受ける** — 文字の選択や別タブの
      // リンクを引いてきても反応させない (dragover の間は types でしか中身が見えない)
      onDragOver={(event) => {
        if (!hasDroppedFiles(event.dataTransfer.types)) {
          return;
        }
        // preventDefault しないと drop が届かず、ブラウザがファイルを開いてしまう
        event.preventDefault();
        event.dataTransfer.dropEffect = busy === null ? "copy" : "none";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // 子要素へ入っても leave は来る。外へ出たときだけ戻す
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        if (!hasDroppedFiles(event.dataTransfer.types)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        onDropFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <button
        type="button"
        onClick={onSend}
        disabled={busy !== null}
        className={`${HEADER_MENU_ITEM_CLASS} ${ROW_DISABLED_CLASS}`}
      >
        <ClipboardUpIcon />
        {busy === "send" ? "送っています…" : "サーバへコピー"}
      </button>
      <PickFileRow disabled={busy !== null} busy={busy === "file"} onPick={onSendFile} />
      {slot && !isPasteable(slot.kind) ? (
        // クリップボードに載せられない種類 (動画・音声・PDF・テキストのファイル)。
        // 保存のリンクにする。JS を挟まないので iOS のユーザー操作の扱いも関係ない
        <a
          href={SERVER_CLIPBOARD_DATA_URL}
          download={slotFileName(slot, now)}
          className={`${HEADER_MENU_ITEM_CLASS} justify-between`}
        >
          <span className="flex items-center gap-2">
            <ClipboardDownIcon />
            サーバから保存
          </span>
          <span className="shrink-0 text-xs font-normal text-gray-500">
            {slotSummary(slot, loadFailed, now)}
          </span>
        </a>
      ) : (
        <button
          type="button"
          onClick={onReceive}
          disabled={busy !== null || !hasSlot}
          className={`${HEADER_MENU_ITEM_CLASS} ${ROW_DISABLED_CLASS} justify-between`}
        >
          <span className="flex items-center gap-2">
            <ClipboardDownIcon />
            {busy === "receive" ? "コピーしています…" : "サーバからペースト"}
          </span>
          <span className="shrink-0 text-xs font-normal text-gray-500">
            {slotSummary(slot, loadFailed, now)}
          </span>
        </button>
      )}
      <div className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between gap-y-0 py-0`}>
        <span className="min-w-0 flex-1 pb-1 text-xs font-normal text-gray-500">
          {DESCRIPTION}
        </span>
        {hasSlot && slot.kind === "image" && (
          // 画像は貼り付けのほかに、元のファイルとして保存もできる
          // (貼れない先・形式のとき。HEIC は JPEG にして置いてある)
          <a
            href={SERVER_CLIPBOARD_DATA_URL}
            download={slotFileName(slot, now)}
            className="flex min-h-8 shrink-0 items-center px-2 text-sm font-medium text-sky-700"
          >
            保存
          </a>
        )}
        {hasSlot && (
          <button
            type="button"
            onClick={onClear}
            disabled={busy !== null}
            className="min-h-8 shrink-0 px-2 text-sm font-medium text-red-700 disabled:opacity-60"
          >
            消す
          </button>
        )}
      </div>
      {loadFailed && (
        <span role="alert" className="block px-3 pb-1 text-sm font-normal text-red-700">
          サーバの状態を読めませんでした
        </span>
      )}
      {notice && (
        <span
          role={notice.tone === "error" ? "alert" : "status"}
          className={`block px-3 pb-1 text-sm font-normal ${
            notice.tone === "error" ? "text-red-700" : "text-emerald-700"
          }`}
        >
          {notice.text}
        </span>
      )}
    </div>
  );
}

// ペースト行の右に出す、いま入っているものの予告。押す前に何が来るか分かる
function slotSummary(
  slot: ClipboardSlotMeta | null | undefined,
  loadFailed: boolean,
  now: Date,
): string {
  if (loadFailed) {
    return "—";
  }
  if (slot === undefined) {
    return "確認中…";
  }
  if (slot === null) {
    return "なし";
  }
  return `${slotLabel(slot)}・${agoLabel(slot.updatedAt, now)}`;
}

// ファイルを選んで送る行。<input type=file> は隠し、行を押すと選択を開く
// (押した同期部で input.click() を呼ぶので、iOS のユーザー操作の扱いは切れない)。
// 選んだ後に value を空に戻す — 同じファイルを続けて選び直しても change が出る
function PickFileRow({
  disabled,
  busy,
  onPick,
}: {
  disabled: boolean;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled}
        className={`${HEADER_MENU_ITEM_CLASS} ${ROW_DISABLED_CLASS}`}
      >
        <ImportIcon />
        {busy ? "ファイルを送っています…" : "ファイルを選んで送る"}
      </button>
      <input
        ref={input}
        type="file"
        accept={FILE_ACCEPT}
        disabled={disabled}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            onPick(file);
          }
        }}
      />
    </>
  );
}
