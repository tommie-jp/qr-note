"use client";

import { useMemo } from "react";
import type { Item } from "@/generated/prisma/client";
import type { ListValue } from "@/lib/client/listStore";
import type { ViewMode } from "@/lib/prefs/viewMode";
import {
  matchSecretTexts,
  mergeSecretRows,
  secretQueryTerms,
  secretRowLabels,
} from "@/lib/secret/search";
import { useSecretSearch } from "@/lib/secret/searchSession";
import { useResultPreviews } from "./useListResults";

// ノート → 当たった断片のラベル。行の印 (🔒 ラベル) に使う
export type SecretRowLabels = Readonly<Record<string, readonly string[]>>;

export interface SecretRows {
  // シークレット内の一致のノート (一覧の先頭に置く順)
  items: Item[];
  labels: SecretRowLabels;
}

// シークレット内の一致を、通常の一覧の行として描く材料にする
// (docs/131-シークレット内検索の行表示計画.md §3)。
//
// 行として出さないとき (トグルが切れている・読み込み中・画像表示) は null。
// **画像表示では行にしない** — タイルは画像そのものなので、出た瞬間にその
// ノートの画像を取りに行き、どのノートが一致したかがサーバに見える
// (docs/131 §2)。一覧表示の行は顔 (サムネ) を出さないことで通信を無くして
// いるが、タイルから画像を抜くと何も残らない。画像表示では今までどおり、
// 黄色い枠に文字の行で出す
export function useSecretRows(query: string, view: ViewMode): SecretRows | null {
  const state = useSecretSearch();
  const index = state.status === "on" ? state.index : null;
  return useMemo(() => {
    if (index === null || view === "image") {
      return null;
    }
    const names = matchSecretTexts(index.haystacks, secretQueryTerms(query));
    const labels = secretRowLabels(index.entries, names);
    const items = [...labels.keys()].flatMap((itemId) => index.notes.get(itemId) ?? []);
    return { items, labels: Object.fromEntries(labels) };
  }, [index, query, view]);
}

// 一覧に描く行と、その行のプレビュー。
//
// **混ぜるのは描く直前だけ。** 一覧の控え (listStore) の値は書き換えず、
// シークレット内の一致を先頭に足した写しを作って ItemList に渡す。件数・続き・
// 空の枠は元の値 (value) で動くので、足した行の分はずれない。控えにも入らない
// ので、一致したノートが端末 (IndexedDB) に残ることもない
export function useShownRows(value: ListValue, query: string, view: ViewMode) {
  const secret = useSecretRows(query, view);
  const rows = useMemo(
    () =>
      secret === null || secret.items.length === 0
        ? value
        : { ...value, items: mergeSecretRows(secret.items, value.items) },
    [secret, value],
  );
  return {
    rows,
    secretLabels: secret?.labels,
    // 一致を行として出している (黄色い枠は見出しだけにする)
    hasSecretRows: secret !== null,
    ...useResultPreviews(rows, view),
  };
}
