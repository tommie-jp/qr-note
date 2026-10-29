"use client";

import { FolderPane, FolderPaneShell } from "@/components/search/FolderPane";
import { foldersCache } from "@/lib/client/listStore";
import { useSearchState } from "@/lib/client/useSearchState";
import type { Sort } from "@/lib/validation";

// 検索フォルダー (docs/86 §5) の中身を GET /api/folders から描く (docs/123 §4-3)。
// 届くまでは空の殻 (FolderPaneShell) — ペインの有無で一覧の幅が変わる
// (globals.css の body:has) ので、後から現れると一覧が横へ跳ねる
export function FolderPaneClient({ cookieSort }: { cookieSort: Sort }) {
  const { query, sort } = useSearchState(cookieSort);
  const folders = foldersCache.useEntry("all")?.value;
  if (folders === undefined) {
    return <FolderPaneShell />;
  }
  return (
    <FolderPane
      tags={folders.tags}
      hiddenTags={folders.hiddenTags}
      totals={folders.totals}
      trashCount={folders.trashCount}
      saved={folders.saved}
      query={query}
      sort={sort}
    />
  );
}
