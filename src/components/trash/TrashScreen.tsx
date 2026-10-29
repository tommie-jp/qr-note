"use client";

import { useMemo } from "react";
import { BusyNotice } from "@/components/chrome/BusyNotice";
import { TrashActionBar } from "@/components/bottombar/TrashActionBar";
import { buildNotePreviews } from "@/components/item/NotePreviewThumb";
import { TrashList } from "@/components/trash/TrashList";
import {
  emptyTrashAction,
  purgeItemsAction,
  restoreItemsAction,
  setTrashSortAction,
  setViewModeAction,
} from "@/lib/client/actions";
import { trashCache } from "@/lib/client/listStore";
import { buildMathTexts } from "@/lib/markdown/mathText";
import { useShownViewMode } from "@/lib/prefs/pendingViewMode";
import type { ViewMode } from "@/lib/prefs/viewMode";
import type { TrashSort } from "@/lib/validation";

// ゴミ箱の一覧 (docs/123 §4-3)。材料は GET /api/trash、プレビューと数式は端末で
export function TrashScreen({
  sort,
  serverView,
  isProd,
}: {
  sort: TrashSort;
  serverView: ViewMode;
  isProd: boolean;
}) {
  const view = useShownViewMode(serverView);
  const entry = trashCache.useEntry({ sort, view });
  const value = entry?.value;
  const mathTexts = useMemo(
    () => (value ? buildMathTexts(value.items, view === "card" ? "both" : "title") : {}),
    [value, view],
  );
  const notePreviews = useMemo(
    () => (value ? buildNotePreviews(value.items, value.circuitThumbs, view) : {}),
    [value, view],
  );

  return (
    <>
      {value === undefined ? (
        entry?.error ? (
          <p role="alert" className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
            ゴミ箱を読み込めませんでした: {entry.error.message}
          </p>
        ) : (
          <BusyNotice role="status" busy>
            ゴミ箱を読み込み中…
          </BusyNotice>
        )
      ) : (
        <div className={entry?.stale || entry?.loading ? "opacity-50 transition-opacity" : undefined}>
          <TrashList
            items={value.items}
            view={view}
            restoreAction={restoreItemsAction}
            purgeAction={purgeItemsAction}
            emptyTrashAction={emptyTrashAction}
            circuitThumbs={value.circuitThumbs}
            mathTexts={mathTexts}
            notePreviews={notePreviews}
          />
        </div>
      )}
      <TrashActionBar
        view={view}
        sort={sort}
        viewAction={setViewModeAction}
        sortAction={setTrashSortAction}
        isProd={isProd}
      />
    </>
  );
}
