"use client";

// 拡大と送りの「いまの値」を持つ (docs/36-お絵かき拡張計画.md §4)。
// useStageGestures から切り出した (docs/128 §8-1)。
//
// 倍率と送りは ref と state の 2 か所に持つ。ハンドラは ref を読み (state を
// 閉じ込めると張り直しが要る)、画面は state で描く。書き込み口を commit と
// resetZoom に絞り、2 か所が食い違わないようにする。
//
// 返り値に ref を混ぜない (ref を持つオブジェクトはレンダー中に読めない
// ものとして扱われるため)。ハンドラには readView で値を渡す

import { useCallback, useRef, useState } from "react";
import type { StageView as StageViewValue } from "@/lib/draw/stageGestures";
import { clampPan, type PanOffset } from "@/lib/draw/zoom";

const NO_PAN: PanOffset = { left: 0, top: 0 };

export interface StageView {
  zoom: number;
  pan: PanOffset;
  // ハンドラから読む最新値。state はレンダリング用で、こちらが正
  readView: () => StageViewValue;
  commit: (nextZoom: number, rawPan: PanOffset, fromZoom: number) => void;
  resetZoom: () => void;
}

// 送りの上限は「拡大後の中身 − 枠」。中身は倍率を変えた後の寸法で測りたいが、
// 変えた直後はまだ描き直されていないので、倍率の比から見込みで出す
function panLimitFor(
  stage: HTMLElement | null,
  content: HTMLElement | null,
  nextZoom: number,
  currentZoom: number,
) {
  if (!stage || !content) {
    return null;
  }
  const box = content.getBoundingClientRect();
  const ratio = currentZoom > 0 ? nextZoom / currentZoom : 1;
  return {
    content: { width: box.width * ratio, height: box.height * ratio },
    view: { width: stage.clientWidth, height: stage.clientHeight },
  };
}

export function useStageView(
  stageRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
): StageView {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanOffset>(NO_PAN);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  const readView = useCallback(
    (): StageViewValue => ({ zoom: zoomRef.current, pan: panRef.current }),
    [],
  );

  // 唯一の書き込み口。ref と state を同時に更新して食い違いを作らない
  const commit = useCallback(
    (nextZoom: number, rawPan: PanOffset, fromZoom: number) => {
      const limit = panLimitFor(stageRef.current, contentRef.current, nextZoom, fromZoom);
      const nextPan = limit ? clampPan(rawPan, limit.content, limit.view) : rawPan;
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    },
    [stageRef, contentRef],
  );

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = NO_PAN;
    setZoom(1);
    setPan(NO_PAN);
  }, []);

  return { zoom, pan, readView, commit, resetZoom };
}
