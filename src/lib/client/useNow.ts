"use client";

import { useSyncExternalStore } from "react";

// 「5分前」を数える基準の今。サーバの描画とハイドレーションの間は null
// (サーバとブラウザで文字を食い違わせない)。開いたままでも数字が古びないよう、
// 間隔ごとに進める。読む側が何人いても時計は 1 つ (値は 1 つの変数に持つ)
const TICK_MS = 30_000;

let current: Date | null = null;

function subscribe(onChange: () => void): () => void {
  current = new Date();
  const timer = setInterval(() => {
    current = new Date();
    onChange();
  }, TICK_MS);
  return () => clearInterval(timer);
}

const getSnapshot = (): Date | null => current;
const getServerSnapshot = (): Date | null => null;

export function useNow(): Date | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
