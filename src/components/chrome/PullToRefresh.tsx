"use client";

// 引っ張って更新 (pull-to-refresh)。一覧の先頭で下へ引くと再読み込みする
// (docs/47-引っ張って更新計画.md)。判定は純関数 (lib/gesture/pullToRefresh) に寄せ、
// ここは touch イベントの配線・インジケータ描画・router.refresh の呼び出しだけ。
//
// なぜ自前か: globals.css で overscroll-behavior:none にして iOS/Android の
// ネイティブな引っ張り更新を止めているため、ジェスチャは自分で判定する。
// リスナーは window に張る。「先頭にいるか」を見る相手は、1 ペインでは
// window、3 / 2 ペインでは一覧の器 [data-results-scroll] (ペインの積み方で
// 一覧だけが内側でスクロールする。docs/86 §4-16)。

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PULL_MAX,
  PULL_THRESHOLD,
  beginPull,
  initialPullState,
  movePull,
  resolveRefresh,
  type PullState,
} from "@/lib/gesture/pullToRefresh";

// 触れた場所から body まで遡って、最初に見つかった縦にスクロールできる
// 入れ子を返す。無ければ null (= window がスクロールの主)
function nearestScroller(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// PTR を始めてよい場所なら「先頭にいるか」を、始めない場所なら null を返す。
//
//   ノートの器の中  … 出さない。**スクロールの有無で決めない** — 短い
//                     ノートは器が伸びきらずスクローラに数えられず、下の
//                     「入れ子なし」へすり抜ける。3 / 2 ペインの body は
//                     overflow:hidden で window は常に先頭なので、ペインの
//                     中を引くだけで一覧ごと再読み込みしていた
//   入れ子なし      … window の先頭か (1 ペインの一覧)
//   一覧の器        … その器の先頭か。3 / 2 ペインでは一覧だけが内側で
//                     スクロールするので、ここが window の代わりになる
//   それ以外の入れ子 … 出さない (モーダル本文など)。
//                     その入れ子の縦スクロールを横取りしないため
function pullStartAtTop(target: EventTarget | null): boolean | null {
  if (target instanceof Element && target.closest("[data-note-pane]")) {
    return null;
  }
  const scroller = nearestScroller(target);
  if (scroller === null) {
    return window.scrollY <= 0;
  }
  if (scroller.hasAttribute("data-results-scroll")) {
    return scroller.scrollTop <= 0;
  }
  return null;
}

export default function PullToRefresh() {
  const router = useRouter();
  // startTransition で router.refresh() を包むので、isPending は「PTR による
  // 更新が進行中か」とちょうど一致する。専用の refreshing state は要らない。
  const [refreshing, startTransition] = useTransition();

  // 判定は 1 回のジェスチャで完結するので ref に持つ (再描画を挟まない)。
  const stateRef = useRef<PullState>(initialPullState());
  // touchstart ハンドラから同期的に読みたいので ref にも写す (下の effect で同期)。
  const refreshingRef = useRef(false);

  const [distance, setDistance] = useState(0);
  // 指で引いている最中だけ true。CSS トランジションの有無を切り替える
  // (追従中は 1:1 で動かし、離したらスッと戻す)。
  const [active, setActive] = useState(false);

  // 更新の進行状態をハンドラ用の ref に写すだけ (setState はしないので
  // カスケード再描画にならない)。畳む動作は描画側で isPending から導出する。
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    // タッチ端末だけで有効化する。マウス/トラックパッドでは touch イベントが
    // 出ないので無害だが、passive:false のリスナーを張らないでおく。
    if (!window.matchMedia?.("(pointer: coarse)").matches) {
      return;
    }

    function reset() {
      stateRef.current = initialPullState();
    }

    function onStart(e: TouchEvent) {
      // 更新中や複数指 (ピンチズーム) のときは掴まない。
      if (refreshingRef.current || e.touches.length !== 1) {
        reset();
        return;
      }
      const atTop = pullStartAtTop(e.target);
      if (atTop === null) {
        reset();
        return;
      }
      const t = e.touches[0];
      stateRef.current = beginPull(stateRef.current, t.clientX, t.clientY, atTop);
    }

    function onMove(e: TouchEvent) {
      if (stateRef.current.phase === "idle" || e.touches.length !== 1) {
        return;
      }
      const t = e.touches[0];
      const next = movePull(stateRef.current, t.clientX, t.clientY);
      stateRef.current = next;
      if (next.phase === "pulling") {
        // 引っ張り中はブラウザのスクロール/更新に渡さない。
        // passive:false で登録しているので preventDefault が効く。
        e.preventDefault();
        setActive(true);
        setDistance(next.distance);
      } else {
        // 途中で縦上/横に譲った。インジケータを戻す。
        setActive(false);
        setDistance(0);
      }
    }

    function onEnd() {
      const finished = stateRef.current;
      reset();
      setActive(false);
      // どちらの分岐でも distance は 0 に戻す。更新中の位置決めは描画側で
      // isPending を見て行う (更新が終われば自然に 0 の位置へ戻る)。
      setDistance(0);
      if (resolveRefresh(finished)) {
        refreshingRef.current = true; // isPending が立つまでの隙間を埋める
        startTransition(() => {
          router.refresh();
        });
      }
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router, startTransition]);

  // 更新中はしきい値の位置で待たせ、それ以外は引き量そのまま。
  // 更新が終われば refreshing が落ちて distance(=0) に戻り、インジケータが畳まれる。
  const shown = refreshing ? PULL_THRESHOLD : distance;
  const armed = shown >= PULL_THRESHOLD;
  const label = refreshing
    ? "更新中…"
    : armed
      ? "離すと更新"
      : "引っ張って更新";

  return (
    <div
      aria-live="polite"
      role="status"
      // ヘッダー (z-20, sticky top-0) より前に出して、引くと上から降りてくる。
      // pt-safe … standalone でステータスバーの下から出す (viewport-fit=cover)。
      // pointer-events-none … 下の一覧のタップを邪魔しない。
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-safe print:hidden"
    >
      <div
        style={{
          transform: `translateY(${shown}px)`,
          opacity: Math.min(shown / PULL_THRESHOLD, 1),
          // 追従中はトランジションを切って指に 1:1 で付ける。離したら戻す/待つ。
          transition: active ? "none" : "transform 200ms ease, opacity 200ms ease",
        }}
        className="mt-1 rounded-full bg-white p-2 shadow-md dark:bg-gray-800"
      >
        <span className="sr-only">{label}</span>
        <span
          aria-hidden
          style={
            // 引っ張り中は引き量に応じて回し「巻き上げ」の手応えを出す。
            // 更新中は animate-spin に任せるので inline の回転は付けない。
            refreshing ? undefined : { transform: `rotate(${(shown / PULL_MAX) * 360}deg)` }
          }
          className={`block size-5 rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-200 ${
            refreshing ? "animate-spin" : ""
          }`}
        />
      </div>
    </div>
  );
}
