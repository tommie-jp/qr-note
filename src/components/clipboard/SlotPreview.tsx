"use client";

import { useState } from "react";
import { PlayBadgeIcon } from "@/components/icons";
import {
  type ClipboardSlotMeta,
  previewText,
  SLOT_THUMB_URL,
  slotFileName,
  slotLabel,
} from "@/lib/clipboard/slot";

// サーバの枠の中身の見本 (docs/115-サーバクリップボードのサムネ計画.md §1-5)。
// メニューの「ペースト / 保存 / 共有」の行の直下に置く。
//
//   絵があるもの (画像・動画・PDF) … 縮小した絵。動画は ▶、PDF は札を重ねる
//   文字・テキストファイル          … 先頭 4 行の抜粋 (テキストファイルは等幅)
//   それ以外                         … 拡張子の札 + 名前と大きさ (Office は抜粋も)
//
// **押せる物に見せない。** 受け取る操作は上の行で、見本は「いま何が入っているか」を
// 確かめるためだけにある。高さは 160px まで — メニューはせり上がるシートで、縦に
// 伸びると上の項目が画面外へ出る。

// 拡張子の札の色。系統で分ける (Word 系は青、Excel 系は緑、PowerPoint 系は橙)
const BADGE_COLOR: Readonly<Record<string, string>> = {
  doc: "bg-blue-600",
  docx: "bg-blue-600",
  odt: "bg-blue-600",
  rtf: "bg-blue-600",
  xls: "bg-green-600",
  xlsx: "bg-green-600",
  ods: "bg-green-600",
  csv: "bg-green-600",
  ppt: "bg-orange-500",
  pptx: "bg-orange-500",
  odp: "bg-orange-500",
  pdf: "bg-red-600",
};
const DEFAULT_BADGE_COLOR = "bg-gray-500";
const MAX_BADGE_CHARS = 5;

export function SlotPreview({ slot }: { slot: ClipboardSlotMeta }) {
  // 絵が読めなかった (期限切れ・消された直後) ときは札に戻す
  const [broken, setBroken] = useState(false);

  if (slot.kind === "text") {
    return <Excerpt text={previewText(slot.text ?? "")} mono={false} />;
  }

  const ext = extensionOf(slot);
  if (slot.hasThumb && !broken) {
    return (
      <div className="px-3 pb-1">
        <div className="relative inline-flex max-w-full items-center justify-center">
          {/* 見本は 1 枚の小さな WebP。next/image の最適化は要らない (no-store の口) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${SLOT_THUMB_URL}?v=${encodeURIComponent(slot.updatedAt)}`}
            alt="サーバのクリップボードの見本"
            className="max-h-40 max-w-full rounded border border-gray-200 object-contain"
            onError={() => setBroken(true)}
          />
          {slot.kind === "video" && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <PlayBadgeIcon />
            </span>
          )}
          {slot.kind === "pdf" && (
            <span className="absolute left-1 top-1">
              <Badge ext={ext} />
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pb-1">
      <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 p-2">
        <Badge ext={ext} />
        <span className="min-w-0 truncate text-sm font-normal text-gray-700">
          {slot.name ?? slotLabel(slot)}
          {slot.name && (
            <span className="ml-2 text-xs text-gray-500">{sizeOf(slotLabel(slot))}</span>
          )}
        </span>
      </div>
      {slot.preview && (
        <Excerpt text={previewText(slot.preview)} mono={slot.kind === "textfile"} inset={false} />
      )}
    </div>
  );
}

function Badge({ ext }: { ext: string }) {
  return (
    <span
      className={`inline-flex min-w-11 shrink-0 justify-center rounded px-1.5 py-1 text-xs font-bold tracking-wide text-white ${
        BADGE_COLOR[ext.toLowerCase()] ?? DEFAULT_BADGE_COLOR
      }`}
    >
      {ext.toUpperCase().slice(0, MAX_BADGE_CHARS)}
    </span>
  );
}

function Excerpt({ text, mono, inset = true }: { text: string; mono: boolean; inset?: boolean }) {
  return (
    <div className={inset ? "px-3 pb-1" : "pt-1"}>
      <p
        className={`line-clamp-4 whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 p-2 text-xs font-normal text-gray-700 ${
          mono ? "font-mono" : ""
        }`}
      >
        {text}
      </p>
    </div>
  );
}

// 札に出す拡張子。保存名 (元の名前、無ければ mime から) の末尾
function extensionOf(slot: ClipboardSlotMeta): string {
  const name = slotFileName(slot);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "file";
}

// 「議事録.docx 2.5MB」から大きさだけ
function sizeOf(label: string): string {
  return label.slice(label.lastIndexOf(" ") + 1);
}
