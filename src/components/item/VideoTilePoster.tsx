"use client";

import { useState } from "react";
import { PlayBadgeIcon, VideoThumbIcon } from "@/components/icons";
import { thumbUrl } from "@/lib/images/memoImages";

// 画像表示のタイルに置く動画の絵 (docs/117 §8)。poster (?thumb=1) を画像の
// タイルと同じ正方形 + contain で見せ、中央に ▶ の印を重ねる。
// poster が無い動画 (生成前・失敗) は 404 になるので、ビデオの記号で代える
// (RowThumb の VideoFallback と同じ判断)
export function VideoTilePoster({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative block aspect-square w-full bg-gray-100">
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center bg-gray-300 text-white">
          <VideoThumbIcon />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl(name)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="block h-full w-full object-contain"
        />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <PlayBadgeIcon />
      </span>
    </span>
  );
}
