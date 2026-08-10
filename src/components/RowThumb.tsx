"use client";

import { useState } from "react";
import { thumbAnimUrl, thumbUrl } from "@/lib/memoImages";
import { useAnimThumb } from "./useAnimThumb";

interface RowThumbProps {
  // 添付の保存名 (`<UUID>.<ext>`)。?thumb=1 で縮小版を配る
  name: string;
  // 動画なら true。poster を出しつつ ▶ バッジを重ね、poster が無ければ
  // ビデオアイコンで代替する
  isVideo: boolean;
  // width/height 属性 (読み込み前から場所を取らせ、届いた瞬間の飛び跳ねを防ぐ)
  sizePx: number;
  // 大きさの Tailwind クラス (size-10 / size-24)
  sizeClass: string;
}

// 一覧の 1 件のサムネ (docs/23-検索結果表示モード計画.md §2, docs/14 §Phase4)。
//
// 画像は従来どおり ?thumb=1 の縮小版を <img> で出す。動画も poster を同じ
// ?thumb=1 で出せるが、**poster が無い動画がある** (iOS 旧録画・生成失敗)。
// サーバは本文の文字列だけからは poster の有無を判定できない (DB を引く必要が
// ある) ため、クライアントで <img> の onError を拾い、動画アイコンへ切り替える。
// これで一覧に壊れた画像アイコンが出ず、動画であることは必ず判る。
//
// 動画にはさらに「動くサムネ」がある (docs/72-動画アニメサムネ計画.md)。
// 既定は静止 poster のままで、ホバー中 (PC) / 画面に入った時 (スマホ) だけ
// 同じ <img> の src をアニメ WebP へ差し替える (useAnimThumb.ts)。
export function RowThumb({ name, isVideo, sizePx, sizeClass }: RowThumbProps) {
  // 動画で poster が 404 だったら true。アイコン表示に切り替える
  const [posterFailed, setPosterFailed] = useState(false);
  const showIcon = isVideo && posterFailed;
  // 分割代入で受ける — まとめた object のまま参照すると、eslint の
  // react-hooks/refs が「描画中に ref を読んでいる」と誤検知する
  const { ref, playing, fail, onMouseEnter, onMouseLeave } = useAnimThumb(
    name,
    isVideo && !posterFailed,
  );

  // 落ちたのが動くサムネ (未生成) なのか poster なのかを分ける。動くサムネなら
  // 静止へ戻すだけで、poster を巻き添えにしてアイコンにしてはいけない。
  //
  // **判定は playing ではなく落ちた URL で行う。** 要求が飛んでいる最中に
  // ポインタが外れる (= playing が false に戻る) ことがあり、その後に届いた
  // 動くサムネの 404 を poster の失敗と取り違えると、生きている poster が
  // 灰色のアイコンに化けたまま戻らない (posterFailed は解除しない)
  const handleError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (event.currentTarget.src.endsWith(thumbAnimUrl(name))) {
      fail();
      return;
    }
    setPosterFailed(true);
  };

  return (
    <span
      className={`relative ${sizeClass} shrink-0 self-center overflow-hidden rounded bg-gray-100`}
      // ホバーは <img> ではなく容器で受ける。▶ バッジが上に重なっているため、
      // <img> に付けると中央にポインタを置いたときだけ差し替わらない
      onMouseEnter={isVideo ? onMouseEnter : undefined}
      onMouseLeave={isVideo ? onMouseLeave : undefined}
    >
      {showIcon ? (
        <VideoIcon />
      ) : (
        <>
          {/* next/image は使えない (画像 API はログイン必須で optimizer に
              Cookie が付かない)。縮小は保存時に済ませてある (thumbnail.ts)。
              alt="" … 装飾。すぐ左のタイトルが中身を説明している */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={ref}
            src={playing ? thumbAnimUrl(name) : thumbUrl(name)}
            alt=""
            width={sizePx}
            height={sizePx}
            loading="lazy"
            decoding="async"
            onError={isVideo ? handleError : undefined}
            className={`${sizeClass} block object-cover`}
          />
          {/* 動いている間はバッジを消す (動いていれば動画だと判る) */}
          {isVideo && !playing && <PlayBadge />}
        </>
      )}
    </span>
  );
}

// poster の中央に重ねる小さな再生バッジ (動画だと一目で判るように)。
function PlayBadge() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-1/3 min-h-4 min-w-4 drop-shadow"
        fill="white"
      >
        <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.45)" />
        <path d="M9 7.5v9l7-4.5z" fill="white" />
      </svg>
    </span>
  );
}

// poster が無い動画のアイコン (ビデオカメラ風)。枠いっぱいの灰色地に白の記号。
function VideoIcon() {
  return (
    <span
      aria-label="動画"
      className="absolute inset-0 flex items-center justify-center text-gray-400"
    >
      <svg viewBox="0 0 24 24" className="size-2/3" fill="currentColor">
        <path d="M4 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm13 3.5 4-2.5v10l-4-2.5z" />
      </svg>
    </span>
  );
}
