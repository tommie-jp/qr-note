"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ViewerTarget } from "@/lib/images/viewerNav";
import { ImageViewerOverlay } from "./ImageViewerOverlay";
import { ImageViewerPane } from "./ImageViewerPane";
import { useScreenWakeLock } from "./useScreenWakeLock";
import { useEscapeKey } from "../modal/useEscapeKey";
import { useViewerMedia, useViewerState } from "./useViewerState";
import { useViewerAdvance, useViewerOpenClose } from "./useViewerNavigation";
import {
  useAwaitMoreResults,
  useSlideshowTimer,
  useStartSlideshow,
  useViewerPlayControls,
} from "./useSlideshow";
import type { ViewerMediaHandlers } from "./ViewerMedia";
import { usePreloadNeighbors, useViewerKeys } from "./useViewerEffects";

interface ImageViewerState {
  current: ViewerTarget | null;
  open: (target: ViewerTarget) => void;
  // 一覧の先頭の画像から、全画面でスライドショーを始める (docs/117 §1)。
  // 押せる画像が 1 枚も無ければ何もせず false
  startSlideshow: () => boolean;
}

const ImageViewerContext = createContext<ImageViewerState | null>(null);

// provider の外では null。押す口 (ViewerImageButton) は null なら素の画像に
// 戻り、今までどおりタイル・行のリンクがノートを開く
export function useImageViewer(): ImageViewerState | null {
  return useContext(ImageViewerContext);
}

// 検索結果の画像を大きく見せるビューア (docs/116)。
//
//   1 ペイン・overlayOnly … 画面全体の覆い (ZoomableImage と同じ見た目)
//   2 / 3 ペイン          … ノートのペインの場所に画像だけを出し、
//                            ペインの高さに縦が全部収まるように縮める
//
// どちらも ← → (釦・キー) で一覧の前後の画像へ送れる。
// ▶ (釦・Space) でスライドショーになり、全画面の覆いで一定の間隔で次へ送る
// (docs/117)。一覧の見出し行の「スライドショー」からは先頭の画像から始まる。
// URL には載せない — 載せると送るたびに検索が走り直す (docs/86 §2 と同じ理由)。
// 再読み込みすればノートの表示に戻る、で足りる
export function ImageViewerProvider({
  overlayOnly = false,
  children,
}: {
  // ノートのペインが無い画面 (ゴミ箱) では常に覆いで出す
  overlayOnly?: boolean;
  children: ReactNode;
}) {
  const state = useViewerState(overlayOnly);
  const { current, asOverlay, playing, awaitingMore, visit } = state;
  const { status, media } = useViewerMedia(visit);
  const { open, close, showFullscreen } = useViewerOpenClose(state);
  const { showTarget, advance, loopToFirst } = useViewerAdvance(state);
  const { step, togglePlay } = useViewerPlayControls({ ...state, advance, showFullscreen });
  const startSlideshow = useStartSlideshow(state);
  useAwaitMoreResults({ ...state, showTarget, loopToFirst });
  useSlideshowTimer({ playing, awaitingMore, current, status, advance, loopToFirst });

  useScreenWakeLock(playing && current !== null);
  usePreloadNeighbors(current, playing);
  useViewerKeys({ current, asOverlay, step, togglePlay });

  // Esc は覆いのときだけ。ペインは Esc を持たない流儀 (docs/86 §2) に合わせる
  useEscapeKey(close, current !== null && asOverlay);

  const value = useMemo(
    () => ({ current, open, startSlideshow }),
    [current, open, startSlideshow],
  );

  return (
    <ImageViewerContext.Provider value={value}>
      {children}
      {current !== null && (
        <ViewerSurface
          target={current}
          asOverlay={asOverlay}
          playing={playing}
          onClose={close}
          onStep={step}
          onFullscreen={showFullscreen}
          onTogglePlay={togglePlay}
          media={media}
        />
      )}
    </ImageViewerContext.Provider>
  );
}

// 覆いかペインのどちらかで 1 枚を出す
function ViewerSurface({
  target,
  asOverlay,
  playing,
  onClose,
  onStep,
  onFullscreen,
  onTogglePlay,
  media,
}: {
  target: ViewerTarget;
  asOverlay: boolean;
  playing: boolean;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  onFullscreen: () => void;
  onTogglePlay: () => void;
  media: ViewerMediaHandlers;
}) {
  return asOverlay ? (
    <ImageViewerOverlay
      target={target}
      onClose={onClose}
      onStep={onStep}
      playing={playing}
      onTogglePlay={onTogglePlay}
      media={media}
    />
  ) : (
    <ImageViewerPane
      target={target}
      onClose={onClose}
      onStep={onStep}
      onFullscreen={onFullscreen}
      onTogglePlay={onTogglePlay}
      media={media}
    />
  );
}
