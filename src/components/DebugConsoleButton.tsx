"use client";

import { useSyncExternalStore } from "react";
import { BugIcon } from "@/components/icons";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";
import {
  isDebugConsoleOn,
  setDebugConsole,
  subscribeDebugConsole,
} from "@/lib/erudaConsole";

// メニューから eruda を出し入れする (docs/30-ブラウザログ計画.md §2)。
//
// ?debug=1 だけでも出せるが、iPhone のアドレス欄でクエリを手打ちするのは
// 苦行なので押せる場所を用意する。メニューはログイン中しか出ないため、
// ログイン前は手打ちになる — 頻度が低いので許す。
//
// 状態の正本は sessionStorage (React の外) なので useSyncExternalStore で読む。
// サーバでは読みようがないため、既定は「出ていない」— ここが食い違うと
// hydration が壊れる
export function DebugConsoleButton() {
  const isOn = useSyncExternalStore(
    subscribeDebugConsole,
    isDebugConsoleOn,
    () => false,
  );

  async function handleClick() {
    try {
      await setDebugConsole(!isOn);
    } catch (error) {
      // 握りつぶさない。読み込みに失敗したなら、押した本人がそれを知るべき
      // (この console.error は転送に乗って /logs に出る)
      console.error("デバッグコンソールを切り替えられませんでした", error);
    }
  }

  return (
    <button type="button" onClick={handleClick} className={HEADER_MENU_ITEM_CLASS}>
      <BugIcon />
      {isOn ? "デバッグを隠す" : "デバッグ"}
    </button>
  );
}
