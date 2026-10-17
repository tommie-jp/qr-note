"use client";

import { PinIcon } from "@/components/icons";
import { PressTip } from "@/components/item/row-actions/PressTip";
import { ACTION_LINK_CLASS } from "@/components/ui";
import {
  setNoteChromePinned,
  useNoteChromePinned,
} from "@/lib/prefs/noteChrome";

// ノートの操作を常に出すか、畳むか (docs/108-ノート全画面表示計画.md §2)。
//
// **出すのはいまの状態** (NotePageModeToggle・PublicToggle と同じ約束)。
// 文字は持たない — 見出し行のトグルはどれも絵だけで、名前は aria-label と
// 長押しの吹き出しが言う。
//
// 端末ごとの好みなので、押した瞬間にこの端末のどのノートにも効く
export function NoteChromePinToggle() {
  const pinned = useNoteChromePinned();

  return (
    <PressTip
      label={
        pinned
          ? "操作を常に出しています — 押すと畳んで本文だけにする"
          : "操作を畳んでいます — 押すと常に出す"
      }
    >
      <button
        type="button"
        aria-label={pinned ? "操作を常に表示" : "操作を畳む"}
        onClick={() => setNoteChromePinned(!pinned)}
        className={ACTION_LINK_CLASS}
      >
        <PinIcon pinned={pinned} />
      </button>
    </PressTip>
  );
}
