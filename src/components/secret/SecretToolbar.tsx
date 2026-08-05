"use client";

import type { ReactNode } from "react";
import {
  DrawIcon,
  ImageInsertIcon,
  MicIcon,
  OcrIcon,
  ScanIcon,
  VideoIcon,
} from "@/components/MenuIcons";

// シークレット入力ダイアログのツール行 (docs/53-シークレット挿入拡張計画.md §4)。
//
// **EditToolbar は流用しない**。あちらはページ下部バーへ portal する作りで、
// 全画面モーダルの下に潜る層にいる。「更新・元に戻す・やり直す」も CodeMirror と
// フォームが前提で、ここの textarea には意味がない。
//
// 流用するのは下の層 — アイコン (MenuIcons) とボタンの見た目だけを揃え、
// 状態とハンドラは SecretDialog が持つ (EditToolbar と同じ役割分担)。

// 見た目は EditToolbar の TOOL_SLOT と揃える (同じ道具が同じ形に見えるように)
const TOOL_SLOT =
  "flex min-h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded px-2 text-[0.625rem] font-medium leading-none whitespace-nowrap text-gray-700 transition-colors active:bg-gray-200/70 disabled:opacity-40 disabled:active:bg-transparent";

function ToolIcon({ color, children }: { color: string; children: ReactNode }) {
  return <span className={`flex ${color}`}>{children}</span>;
}

export interface SecretToolbarProps {
  disabled: boolean;
  onInsertImage: () => void;
  onDraw: () => void;
  // 録音 (トグル)。録音中は disabled でも押せる (止められないと終わらない)
  recordLabel: string;
  isRecording: boolean;
  onToggleRecord: () => void;
  onRecordVideo: () => void;
  // カーソル位置の画像を読む。読める画像が無ければ呼び出し側が知らせる
  ocrLabel: string;
  onOcr: () => void;
  onScan: () => void;
}

export function SecretToolbar({
  disabled,
  onInsertImage,
  onDraw,
  recordLabel,
  isRecording,
  onToggleRecord,
  onRecordVideo,
  ocrLabel,
  onOcr,
  onScan,
}: SecretToolbarProps) {
  return (
    <div className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto border-t border-gray-200 pt-1">
      <button
        type="button"
        onClick={onInsertImage}
        disabled={disabled}
        className={TOOL_SLOT}
      >
        <ToolIcon color="text-violet-600">
          <ImageInsertIcon />
        </ToolIcon>
        画像
      </button>
      <button
        type="button"
        onClick={onToggleRecord}
        // 録音中だけは busy でも押せる。止められないと録音が終わらない
        disabled={disabled && !isRecording}
        aria-pressed={isRecording}
        className={TOOL_SLOT}
      >
        <ToolIcon color="text-rose-600">
          {isRecording ? (
            <span aria-hidden className="size-6 flex items-center justify-center">
              <span className="size-2.5 animate-pulse rounded-full bg-rose-600" />
            </span>
          ) : (
            <MicIcon />
          )}
        </ToolIcon>
        {recordLabel}
      </button>
      <button
        type="button"
        onClick={onRecordVideo}
        disabled={disabled}
        className={TOOL_SLOT}
      >
        <ToolIcon color="text-orange-600">
          <VideoIcon />
        </ToolIcon>
        録画
      </button>
      <button
        type="button"
        onClick={onDraw}
        disabled={disabled}
        className={TOOL_SLOT}
      >
        <ToolIcon color="text-emerald-600">
          <DrawIcon />
        </ToolIcon>
        お絵かき
      </button>
      <button
        type="button"
        onClick={onOcr}
        disabled={disabled}
        className={TOOL_SLOT}
      >
        <ToolIcon color="text-teal-600">
          <OcrIcon />
        </ToolIcon>
        {ocrLabel}
      </button>
      <button
        type="button"
        onClick={onScan}
        disabled={disabled}
        className={TOOL_SLOT}
      >
        <ToolIcon color="text-sky-600">
          <ScanIcon />
        </ToolIcon>
        スキャン
      </button>
    </div>
  );
}
