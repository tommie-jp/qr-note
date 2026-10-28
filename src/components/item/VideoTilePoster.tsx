"use client";

import { useState } from "react";
import { PlayBadgeIcon, VideoThumbIcon } from "@/components/icons";
import { thumbAnimUrl, thumbUrl } from "@/lib/images/memoImages";
import { useAnimThumb } from "../video/useAnimThumb";

// ▶ の印の大きさ。タイルは 160px 前後あり、行のサムネと同じ 1/3 では
// 絵を隠しすぎる (2026-10-28 指摘)。行の大表示 (96px の 1/3) と同じ見た目の 32px
const TILE_BADGE_SIZE_CLASS = "size-8";

// 画像表示のタイルに置く動画の絵 (docs/117 §8-1)。poster (?thumb=1) を画像の
// タイルと同じ正方形 + contain で見せ、中央に ▶ の印を重ねる。
//
// **常に動くサムネ (アニメ WebP) にする** (docs/72・docs/117 §8-8)。行のサムネ
// (RowThumb) と同じ useAnimThumb。▶ は動いていても出す。
//
// poster が無い動画 (生成前・失敗) は 404 になるので、ビデオの記号で代える。
// 落ちたのが動くサムネ (未生成) なら静止へ戻すだけにする — 判定は落ちた URL で
// 行う (RowThumb の handleError と同じ理由)
export function VideoTilePoster({ name }: { name: string }) {
  const [posterFailed, setPosterFailed] = useState(false);
  const { playing, fail } = useAnimThumb(!posterFailed);

  const handleError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (event.currentTarget.src.endsWith(thumbAnimUrl(name))) {
      fail();
      return;
    }
    setPosterFailed(true);
  };

  return (
    <span className="relative block aspect-square w-full bg-gray-100">
      {posterFailed ? (
        <span className="absolute inset-0 flex items-center justify-center bg-gray-300 text-white">
          <VideoThumbIcon />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={playing ? thumbAnimUrl(name) : thumbUrl(name)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={handleError}
          className="block h-full w-full object-contain"
        />
      )}
      {/* 動いていても出す (動画だと一目で判る。小さめの 32px) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <PlayBadgeIcon sizeClass={TILE_BADGE_SIZE_CLASS} />
      </span>
    </span>
  );
}
