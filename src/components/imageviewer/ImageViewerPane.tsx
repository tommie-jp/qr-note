"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ClearIcon, OpenFullIcon } from "@/components/icons";
import { PANE_BOX_CLASS } from "@/components/panes/paneBox";
import type { ViewerTarget } from "@/lib/images/viewerNav";
import {
  OpenNoteLink,
  StepButton,
  VIEWER_ROUND_BUTTON_CLASS,
} from "./ViewerControls";
import { ViewerImage } from "./ViewerImage";

interface ImageViewerPaneProps {
  target: ViewerTarget;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  onFullscreen: () => void;
}

// 2 / 3 ペインで、ノートのペインの場所に画像だけを出す (docs/116 §3)。
//
// 器はノートのペイン (PreviewPane) と**同じ PANE_BOX_CLASS.pane** — 高さ
// (--preview-pane-h) も下端 (--bottom-bar-h) も同じ式なので、境界のドラッグ
// (ノートのペインの PaneResizer。z-20 でこの上に出る) にもそのまま追随する。
// 後から body へ portal するので、同じ z-0 でも DOM 順でノートのペインの上に来る。
//
// 中は縦の flex: 操作行の下を画像の器 (flex-1 min-h-0) にし、画像は
// object-contain で器に収める。これで**縦が必ず全部見える**。
// スクロールはしない (器からはみ出す物が無い)
export function ImageViewerPane({
  target,
  onClose,
  onStep,
  onFullscreen,
}: ImageViewerPaneProps) {
  const sectionRef = useRef<HTMLElement>(null);
  // 下に隠れたノートのペインは inert にする。見えていないノートのリンクや
  // 本文へ Tab で焦点が潜り、読み上げにも 2 つの面が並んでしまうため。
  // ノートのペインは別の部品 (PreviewPane) が持つので、器の目印
  // (data-note-pane) で引いて、閉じるときに外す
  useEffect(() => {
    const covered = [
      ...document.querySelectorAll<HTMLElement>("[data-note-pane]"),
    ].filter((el) => el !== sectionRef.current && !el.inert);
    for (const el of covered) {
      el.inert = true;
    }
    return () => {
      for (const el of covered) {
        el.inert = false;
      }
    };
  }, []);

  return createPortal(
    // data-preview-pane … 一覧の底上げと、フォルダーが居るときの左寄せの
    //   フック (globals.css)。ノートのペインが居なくても一覧が下に潜らない。
    // data-note-pane … 器の中では引っ張って更新を始めない (PullToRefresh)
    // data-image-viewer … 中の釦に焦点があっても ← → を受ける目印
    <section
      ref={sectionRef}
      data-image-viewer=""
      data-preview-pane=""
      data-note-pane=""
      aria-label="画像の表示"
      className={`fixed inset-x-0 m-0 flex flex-col bg-neutral-900 ${PANE_BOX_CLASS.pane}`}
    >
      {/* 右上の操作。flex-wrap … 3 ペインの狭い画面ではペインの幅が 170px
          ほどしか無く、1 行に並ばない分は次の行へ送る (縮めて文字を縦に
          折らない) */}
      <div className="flex flex-wrap items-center justify-end gap-2 px-safe pt-1.5 pb-1">
        <OpenNoteLink href={target.href} onClose={onClose} />
        <button
          type="button"
          aria-label="全画面で見る"
          title="全画面で見る"
          onClick={onFullscreen}
          className={VIEWER_ROUND_BUTTON_CLASS}
        >
          <OpenFullIcon />
        </button>
        <button
          type="button"
          aria-label="閉じる"
          title="閉じる"
          onClick={onClose}
          className={VIEWER_ROUND_BUTTON_CLASS}
        >
          <ClearIcon />
        </button>
      </div>
      {/* pb-safe … 下部バーの無い画面ではペインの下端が画面の下端になる */}
      <div className="relative min-h-0 flex-1 px-safe pb-safe">
        <div className="relative h-full w-full">
          <ViewerImage name={target.name} />
        </div>
        {/* 前後は画像の左右の中ほど (覆いと同じ置き方)。操作行に並べると
            狭いペインで行が溢れる */}
        <StepButton
          dir={-1}
          onStep={onStep}
          className="absolute top-1/2 left-2 -translate-y-1/2"
        />
        <StepButton
          dir={1}
          onStep={onStep}
          className="absolute top-1/2 right-2 -translate-y-1/2"
        />
      </div>
    </section>,
    document.body,
  );
}
