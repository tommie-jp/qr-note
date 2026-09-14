"use client";

// 一覧のサムネを「動くサムネ」(アニメーション WebP) へ差し替える
// (docs/72-動画アニメサムネ計画.md §Phase3)。13-kick-work の
// html/src/clip-anim.js を React へ移したもの。
//
// **一覧に <video> を並べない**のが前提。行数ぶんの動画を同時に読みに行くと
// モバイル回線で破綻する (13-kick-work のショートで実測済み)。<img> の src を
// 差し替えるだけなら、普通の画像 1 枚ぶんの通信で済む。
//
// 差し替える条件は端末で変える:
//   - ポインタがある端末 (PC) … ホバー中だけ。一覧を眺めるだけの人に
//     全行ぶんの転送をさせない
//   - それ以外 (スマホ) … ホバーが無いので、画面にしっかり入ったものだけ。
//     画面から出たら静止画へ戻し、さらに 1 セッションで動かす本数を
//     MAX_AUTO_ANIM で頭打ちにする (animThumbBudget.ts)

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTO_VISIBLE_RATIO,
  isVisibleEnough,
  releaseAutoAnimSlot,
  takeAutoAnimSlot,
} from "@/lib/video/animThumbBudget";

// 1 セッションで自動再生に使ったサムネ。**モジュールスコープ**に置くのが要点 —
// 一覧の行は再描画で作り直されるので、コンポーネントの中に持つと勘定が
// リセットされて上限が効かなくなる。
const autoPlayed = new Set<string>();

// (hover: hover) だけだと、ホバーを模倣する一部のタッチ端末で
// 「触れないと動かないサムネ」になる。実ポインタも条件に加える。
function isHoverCapable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

export interface AnimThumb {
  // 監視対象の <img> に付ける ref (スマホの画面内判定に使う)
  ref: React.RefObject<HTMLImageElement | null>;
  // 今アニメを出しているか。false のときは静止サムネ
  playing: boolean;
  // アニメが取れなかった (未生成 = 404) ときに呼ぶ。以後この行では試さない
  fail: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

// key は上限の勘定に使う識別子 (添付の保存名)。
// enabled が false のときは何もしない (画像の行・poster が無い動画)。
export function useAnimThumb(key: string, enabled: boolean): AnimThumb {
  const ref = useRef<HTMLImageElement | null>(null);
  const [playing, setPlaying] = useState(false);
  // 未生成 (404) だった行。一度落ちたら二度と試さない — 押すたびに 404 を
  // 叩きに行かないため (13-kick-work の handleError で data-anim を消すのと同じ)
  const [failed, setFailed] = useState(false);
  const active = enabled && !failed;

  useEffect(() => {
    if (!active) {
      return;
    }
    // ホバー端末は見えていても自動では動かさない (ホバーでだけ動かす)。
    // window を触るのでマウント後に判定する (SSR では判らない)
    if (isHoverCapable()) {
      return;
    }
    const img = ref.current;
    if (!img || typeof IntersectionObserver !== "function") {
      return;
    }
    // 出入りの両方を拾いたいので unobserve しない (画面外で静止画へ戻すため)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // isIntersecting ではなく交差率で判定する (isVisibleEnough の説明)
          if (!isVisibleEnough(entry.intersectionRatio)) {
            setPlaying(false); // 画面外のサムネを描き続けさせない
            continue;
          }
          if (takeAutoAnimSlot(autoPlayed, key)) {
            setPlaying(true);
          }
        }
      },
      { threshold: AUTO_VISIBLE_RATIO },
    );
    observer.observe(img);
    return () => observer.disconnect();
  }, [active, key]);

  // ホバー端末だけが対象。タッチ端末はタップで合成 mouseenter/mouseleave が
  // 飛ぶことがあり、素通しすると (1) 上限の外から差し替わる (2) タップだけで
  // 画面内のアニメが止まり、スクロールし直すまで戻らない — の両方が起こる。
  // 止めるほうにも同じ条件を掛けるのはそのため
  const onMouseEnter = useCallback(() => {
    if (active && isHoverCapable()) {
      setPlaying(true);
    }
  }, [active]);

  const onMouseLeave = useCallback(() => {
    if (isHoverCapable()) {
      setPlaying(false);
    }
  }, []);

  const fail = useCallback(() => {
    // 一度も再生できていないので上限の勘定から戻す。生成が追いついていない
    // 動画が並ぶ一覧で、404 だけで枠を使い切らないようにする
    releaseAutoAnimSlot(autoPlayed, key);
    setFailed(true);
    setPlaying(false);
  }, [key]);

  return { ref, playing, fail, onMouseEnter, onMouseLeave };
}
