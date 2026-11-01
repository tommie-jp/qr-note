"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { NoteNav } from "@/components/item/NoteNav";
import { NoteView } from "@/components/item/NoteView";
import { PreviewPane } from "@/components/panes/PreviewPane";
import {
  clientNoteClickHref,
  openClientNote,
  registerClientNotePane,
} from "@/lib/client/clientNoteNav";
import { dropDeferredRefresh, flushDeferredRefresh } from "@/lib/client/navigation";
import { useSearchState } from "@/lib/client/useSearchState";
import { buildItemUrl, itemIdFromPathname } from "@/lib/search/url";
import { isValidItemId, type Sort } from "@/lib/validation";

interface ShownNote {
  itemId: string;
  query: string;
  sort: Sort;
  saved: string | undefined;
}

const sameNote = (a: ShownNote, b: ShownNote | null): boolean =>
  b !== null &&
  a.itemId === b.itemId &&
  a.query === b.query &&
  a.sort === b.sort &&
  a.saved === b.saved;

// 検索画面の中のノートの器を、URL から端末で描く (docs/123 §12)。
//
// 一覧の行などを押すと clientNoteNav が pushState で URL を /item/<id> にし、
// この部品がその番号の NoteView を PreviewPane に入れて出す。サーバへは
// 行かない (本文・描画材料・前後は NoteView / NoteNav が控えと API から取る)。
// 戻る・進むは Next が履歴の木を復元し、usePathname が付いてくる。
//
// 横取りスロット ((search)/@detail/(.)item/[itemId]) は、UUID の番号では何も
// 描かない (この部品と二重にならないように)。旧番号 (/item/1003) の解決は
// サーバが要るので、あちらが受ける。
//
// **3 ペインでは URL が /item から離れても最後のノートを出し続ける**
// (PreviewPane の keepOpen。docs/86 §4-4)。そのために最後に出したノートを
// 覚える。旧番号の URL に来たら、あちらが器を出すので忘れる
export function ClientNotePane({
  bgClass,
  isDemo,
  cookieSort,
}: {
  bgClass: string;
  isDemo: boolean;
  cookieSort: Sort;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, sort } = useSearchState(cookieSort);
  const pathItemId = itemIdFromPathname(pathname);
  const onClientNote = pathItemId !== null && isValidItemId(pathItemId);
  const current: ShownNote | null = onClientNote
    ? { itemId: pathItemId, query, sort, saved: searchParams.get("saved") ?? undefined }
    : null;

  // 最後に出したノート (前の描画の値を state に控える React の作法)
  const [last, setLast] = useState<ShownNote | null>(current);
  if (current !== null && !sameNote(current, last)) {
    setLast(current);
  }
  const onOldKey = pathItemId !== null && !onClientNote;
  if (onOldKey && last !== null) {
    setLast(null);
  }

  // 印の付いたリンクの素の左クリックを横取りする。capture で document に
  // 付けるので、Link の onClick より先に走る (Link は defaultPrevented を
  // 見て自分の遷移をやめる)。行の他の onClick (計測・題の控え) はそのまま走る
  useEffect(() => {
    const unregister = registerClientNotePane();
    const onClick = (event: MouseEvent) => {
      const href = clientNoteClickHref(event, location.origin);
      if (href === null) {
        return;
      }
      event.preventDefault();
      openClientNote(href);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      unregister();
      dropDeferredRefresh();
    };
  }, []);

  // ノートを閉じたら、出している間に遅らせた refresh を流す
  // (navigation.ts の refreshRouter)
  useEffect(() => {
    flushDeferredRefresh();
  }, [pathname]);

  const shown = current ?? (onOldKey ? null : last);
  if (shown === null) {
    return null;
  }
  return (
    // key … ノート間を移ったとき器を作り直し、前のノートのスクロール位置を
    // 持ち越さない (横取りスロットの器と同じ)
    <PreviewPane
      key={shown.itemId}
      bgClass={bgClass}
      itemId={shown.itemId}
      openHref={buildItemUrl(shown.itemId, shown.query, shown.sort)}
    >
      <NoteView itemId={shown.itemId} saved={shown.saved} isDemo={isDemo} shell="pane" />
      <NoteNav itemId={shown.itemId} query={shown.query} sort={shown.sort} />
    </PreviewPane>
  );
}
