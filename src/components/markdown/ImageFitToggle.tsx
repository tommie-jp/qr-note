"use client";

import { FitPageIcon, FitWidthIcon } from "@/components/icons";
import { PressTip } from "@/components/item/row-actions/PressTip";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { setImageFit, useImageFit } from "@/lib/prefs/imageFit";

// 画像の表示モードの切り替え (docs/106-画像表示モード計画.md)。
//
// 作りはページ送りの切り替え (notepage/NotePageModeToggle.tsx) に揃える:
// 置き場は見出し行、**出すのはいまの状態**、文字は持たず名前と説明は
// aria-label と長押しの吹き出しが言う。aria-pressed は付けない
// (aria-label が状態そのもので、二重に読み上げられるだけになる)。
//
// 画像の無いノートでは**呼ぶ側が出さない** (ItemView)。押しても見た目が
// 何も変わらないボタンになる。
export function ImageFitToggle() {
  const fit = useImageFit();
  const isPage = fit === "page";

  return (
    <PressTip
      label={
        isPage
          ? "画像は全体を表示中 — 押すと幅に合わせる"
          : "画像は幅に合わせ中 — 押すと全体を表示する"
      }
    >
      <button
        type="button"
        aria-label={isPage ? "画像は全体を表示" : "画像は幅に合わせる"}
        onClick={() => setImageFit(isPage ? "width" : "page")}
        className={ACTION_LINK_CLASS}
      >
        {isPage ? <FitPageIcon /> : <FitWidthIcon />}
      </button>
    </PressTip>
  );
}
