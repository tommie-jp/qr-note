"use client";

import { useEffect, useRef, useState } from "react";

// active の間、ポインタもキーも触られずに ms 経ったら true (docs/117 §3)。
// スライドショーの再生中に操作の釦を隠し、触ればまた出すために使う。
// 呼ぶ側は `active && idle` で使う (止めた後に残った true は見えない)。
//
// 時計は ref で持ち、触るたびに掛け直す。state で回数を数えると、マウスを
// 動かすたびに覆いごと描き直すことになる (idle の false → false は React が省く)
export function useIdleWhile(active: boolean, ms: number): boolean {
  const [idle, setIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    const restart = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (activeRef.current) {
        timerRef.current = setTimeout(() => setIdle(true), ms);
      }
    };
    activeRef.current = active;
    restart();
    // 触ったことは active でない間も拾う — 一時停止中に ▶ を押した、その
    // 押下で idle を戻さないと、再開した瞬間に前の true で消える
    const wake = () => {
      setIdle(false);
      restart();
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, ms]);

  return idle;
}
