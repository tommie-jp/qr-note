"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NoteView } from "@/components/item/NoteView";
import { noteCache } from "@/lib/client/noteStore";
import { itemIdFromPathname } from "@/lib/search/url";

// /item の読み込み中 (loading.tsx) に、控えにあるノートを先に描く
// (docs/123 §4-1)。無ければ fallback (骨組み) を出し、控えを取りに行く
export function CachedNotePreview({ isDemo, fallback }: { isDemo: boolean; fallback: ReactNode }) {
  const itemId = itemIdFromPathname(usePathname());
  const cached = noteCache.useEntry(itemId)?.value;
  if (itemId === null || cached === undefined) {
    return fallback;
  }
  return <NoteView itemId={itemId} isDemo={isDemo} shell="page" />;
}
