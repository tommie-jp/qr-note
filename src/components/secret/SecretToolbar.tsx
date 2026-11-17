"use client";

import type { ReactNode } from "react";
import {
  DrawIcon,
  ImageInsertIcon,
  MicIcon,
  OcrIcon,
  ScanIcon,
  VideoIcon,
} from "@/components/icons";

// シークレット入力ダイアログのツール行 (docs/53-シークレット挿入拡張計画.md §4)。
//
// **EditToolbar は流用しない**。あちらはページ下部バーへ portal する作りで、
// 全画面モーダルの下に潜る層にいる。「更新・元に戻す・やり直す」も CodeMirror と
// フォームが前提で、ここの textarea には意味がない。
//
// 流用するのは下の層 — アイコン (components/icons) とボタンの見た目だけを揃え、
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

interface ToolSpec {
  key: string;
  onClick: () => void;
  // 省略すればツール行の disabled に従う
  disabled?: boolean;
  pressed?: boolean;
  color: string;
  icon: ReactNode;
  label: ReactNode;
}

// ツール行の 1 つの釦。6 つとも同じ形なので、違うところ (色・図・文字・
// 押せる条件) だけを受け取る。pressed は録音のトグルだけが渡す
// (渡さなければ aria-pressed は付かない。以前と同じ)
function ToolButton({
  onClick,
  disabled,
  pressed,
  color,
  icon,
  label,
}: Omit<ToolSpec, "key" | "disabled"> & { disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={TOOL_SLOT}
    >
      <ToolIcon color={color}>{icon}</ToolIcon>
      {label}
    </button>
  );
}

// 録音中の図。マイクの代わりに脈打つ赤丸を出す
function RecordingDot() {
  return (
    <span aria-hidden className="size-6 flex items-center justify-center">
      <span className="size-2.5 animate-pulse rounded-full bg-rose-600" />
    </span>
  );
}

// 釦の並び (左から)。並び順・色・文字は以前の JSX と同じ
function toolSpecs(props: SecretToolbarProps): ToolSpec[] {
  const { isRecording } = props;
  return [
    {
      key: "image",
      onClick: props.onInsertImage,
      color: "text-violet-600",
      icon: <ImageInsertIcon />,
      label: "画像",
    },
    {
      key: "record",
      onClick: props.onToggleRecord,
      // 録音中だけは busy でも押せる。止められないと録音が終わらない
      disabled: props.disabled && !isRecording,
      pressed: isRecording,
      color: "text-rose-600",
      icon: isRecording ? <RecordingDot /> : <MicIcon />,
      label: props.recordLabel,
    },
    {
      key: "video",
      onClick: props.onRecordVideo,
      color: "text-orange-600",
      icon: <VideoIcon />,
      label: "録画",
    },
    {
      key: "draw",
      onClick: props.onDraw,
      color: "text-emerald-600",
      icon: <DrawIcon />,
      label: "お絵かき",
    },
    {
      key: "ocr",
      onClick: props.onOcr,
      color: "text-teal-600",
      icon: <OcrIcon />,
      label: props.ocrLabel,
    },
    {
      key: "scan",
      onClick: props.onScan,
      color: "text-sky-600",
      icon: <ScanIcon />,
      label: "スキャン",
    },
  ];
}

export function SecretToolbar(props: SecretToolbarProps) {
  return (
    <div className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto border-t border-gray-200 pt-1">
      {toolSpecs(props).map(({ key, disabled = props.disabled, ...spec }) => (
        <ToolButton key={key} disabled={disabled} {...spec} />
      ))}
    </div>
  );
}
