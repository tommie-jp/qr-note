"use client";

import { isValidVideoName } from "@/lib/uploads/names";
import { ViewerImage } from "./ViewerImage";
import { ViewerVideo } from "./ViewerVideo";

export interface ViewerMediaHandlers {
  // 表示の番号 (ImageViewerProvider)。変わるたびに 1 枚を作り直す
  visit: number;
  // 原寸を読み終えた・読めなかった・動画を再生できなかった
  onSettled: () => void;
  // 動画が流れ始めた (やり直しも含む)。「再生できなかった」「終わった」を解く
  onVideoPlaying: () => void;
  onVideoEnded: () => void;
  videoSound: boolean;
  onVideoSoundChange: (sound: boolean) => void;
}

// ビューアの 1 枚。名前が動画なら動画を、それ以外は画像を出す (docs/117 §8)。
// 表示の番号を key にして、送る・戻るたびに作り直す — 同じ動画へ戻っても
// 頭から流れ直し、前の再生を引き継がない
export function ViewerMedia({
  name,
  handlers,
}: {
  name: string;
  handlers: ViewerMediaHandlers;
}) {
  if (isValidVideoName(name)) {
    return (
      <ViewerVideo
        key={handlers.visit}
        name={name}
        sound={handlers.videoSound}
        onSoundChange={handlers.onVideoSoundChange}
        onSettled={handlers.onSettled}
        onPlaying={handlers.onVideoPlaying}
        onEnded={handlers.onVideoEnded}
      />
    );
  }
  return (
    <ViewerImage
      key={handlers.visit}
      name={name}
      onSettled={handlers.onSettled}
    />
  );
}
