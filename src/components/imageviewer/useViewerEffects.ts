"use client";

import { useEffect } from "react";
import { attachmentUrl, thumbUrl } from "@/lib/images/memoImages";
import { isValidVideoName } from "@/lib/uploads/names";
import { sameTarget, type ViewerTarget } from "@/lib/images/viewerNav";
import { requestLoadMore } from "../search/loadMore";
import { acceptsArrowKeys, openersInPage, targetOf } from "./viewerDom";

// 残りがこの枚数以下になったら次のページを先読みする (末尾で待たせない)。
// 1 ページは 20 件なので、半ページ手前で頼めば → を押し続けても追いつかない
const PREFETCH_REMAINING = 10;
// 出している画像の前後で、原寸を先に取っておく枚数 (送った瞬間に原寸が出る)。
// スライドショー中は手で送るより速く進む (3 秒間隔で数 MB の写真が続く)
// ので、先を厚めに取る
const PRELOAD_AHEAD = 2;
const PRELOAD_AHEAD_PLAYING = 4;
const PRELOAD_BEHIND = 1;

// 先読み。前後の画像の原寸を先に取っておき (送ってから取りに行くと、
// サムネの引き伸ばしから原寸に替わるまでの間が見える)、末尾に近ければ
// 次のページを頼む。並びは今の画面から拾う
export function usePreloadNeighbors(current: ViewerTarget | null, playing: boolean) {
  useEffect(() => {
    if (current === null) {
      return;
    }
    const targets = openersInPage().map(targetOf);
    const index = targets.findIndex((t) => sameTarget(t, current));
    if (index === -1) {
      return;
    }
    const ahead = playing ? PRELOAD_AHEAD_PLAYING : PRELOAD_AHEAD;
    const neighbors = [
      ...targets.slice(index + 1, index + 1 + ahead),
      ...targets.slice(Math.max(0, index - PRELOAD_BEHIND), index),
    ];
    for (const t of neighbors) {
      // 動画は先に取らない (数十 MB になりうる)。poster だけ温めておく
      new Image().src = isValidVideoName(t.name)
        ? thumbUrl(t.name)
        : attachmentUrl(t.name);
    }
    // 末尾に近ければ次のページも頼む。送ったときだけでなく、末尾近くの
    // 画像を押して開いたときにも効く
    if (targets.length - index <= PREFETCH_REMAINING) {
      requestLoadMore();
    }
  }, [current, playing]);
}

// キーを見送るか。修飾キーつき・既に処理済み・動画のプレーヤーの上・
// 矢印を受けない所に焦点があるとき
function ignoresKey(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    // 動画のプレーヤーに焦点があるときは、矢印 (早送り・巻き戻し) と
    // Space (再生・停止) をプレーヤーに任せる
    event.target instanceof HTMLVideoElement ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !acceptsArrowKeys(event.target)
  );
}

// ← → で送り、全画面の覆いでは Space で再生 / 一時停止
export function useViewerKeys({
  current,
  asOverlay,
  step,
  togglePlay,
}: {
  current: ViewerTarget | null;
  asOverlay: boolean;
  step: (dir: -1 | 1) => void;
  togglePlay: () => void;
}) {
  useEffect(() => {
    if (current === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (ignoresKey(event)) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === " " && asOverlay) {
        // Space で再生 / 一時停止 (動画の再生と同じ手)。全画面の覆いの
        // ときだけ — ペインのときは一覧の Space (スクロール) を奪わない。
        // 焦点のある釦を押させない — 一覧の画像の釦なら、開き直して再生が止まる
        event.preventDefault();
        if (!event.repeat) {
          togglePlay();
        }
      }
    };
    // 釦は Space を離したときに押される。keydown を止めても押されるブラウザが
    // あるので、離す側も止める
    const onKeyUp = (event: KeyboardEvent) => {
      if (
        event.key === " " &&
        asOverlay &&
        !(event.target instanceof HTMLVideoElement) &&
        acceptsArrowKeys(event.target)
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [asOverlay, current, step, togglePlay]);
}
