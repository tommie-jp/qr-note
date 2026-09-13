"use client";

import { useEffect, useRef, type RefObject } from "react";

// いまの値を ref に写しておく (docs/93-リファクタリング計画.md §3-2)。
//
// 1 度だけ束ねたイベントハンドラ・useCallback([]) の関数から、そのときどきの
// props を読むための控え。依存に値そのものを入れると、変わるたびにリスナーや
// interval を張り直すことになる。
//
// **写すのはコミットの後 (useEffect)**。描画中に ref へ書くのは React 19 の
// 規則違反で (中断・やり直しされた描画の値が漏れる)、以前の手書きの鏡 effect も
// すべて useEffect だった。読むのはイベント・タイマー・後続の effect なので、
// コミット後の値で足りる。同じ部品の中では、これより後に書いた effect が
// 走る時点で既に写し終わっている
//
// 返す ref は読むだけにする (書くと次のコミットで上書きされる)。
// eslint の exhaustive-deps は自作フックの戻り値を ref と見抜けないので、
// 使う側の依存配列には入れる (中身が変わっても ref 自体は同一)
export function useLatest<T>(value: T): Readonly<RefObject<T>> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
