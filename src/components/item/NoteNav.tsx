"use client";

import { ItemListNav } from "@/components/item/ItemListNav";
import { neighborsCache } from "@/lib/client/noteStore";
import type { Sort } from "@/lib/validation";

// 一覧の中の前後 (docs/60 §4)。前後は GET /api/items/:id/neighbors から。
// 一覧の文脈 (検索語) が無ければ出さない (ItemListNavSection と同じ)
export function NoteNav({ itemId, query, sort }: { itemId: string; query: string; sort: Sort }) {
  const entry = neighborsCache.useEntry(query ? { itemId, query, sort } : null);
  if (!query || entry?.value === undefined) {
    return null;
  }
  return <ItemListNav prev={entry.value.prev} next={entry.value.next} query={query} sort={sort} />;
}
