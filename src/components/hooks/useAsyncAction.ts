"use client";

import { useCallback, useState } from "react";

// 押した操作の「処理中」と「失敗の文言」を持つ (docs/93-リファクタリング計画.md §3-2)。
//
// 以前は部品ごとに setError(null) → setBusy(true) → await → catch で文言 →
// finally で setBusy(false) を手書きしていた。流れはここで 1 本にし、
// **何を失敗として出すか**だけを呼び出し側が onError で決める。
//
// 同じ形に見えても寄せていないもの:
// - PasskeyManager … busy が真偽ではなく「どのボタンが処理中か」を持つ
// - RowTintMenuItem … 失敗は文言ではなく真偽 (文言は JSX 側に固定)
// - LogoutButton … 成功時は再読み込みまで busy を戻さない (finally が無い)

// 失敗したときの後始末をして、画面に出す文言を返す。null なら何も出さない
// (自分で取り消した操作など)。記録 (console.error) もここで行う
export type AsyncActionErrorHandler = (cause: unknown) => string | null;

export interface AsyncActionSetters {
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}

// 流れの本体。React に触らないので、setter を偽物にしてテストできる。
// **投げない** — 失敗は onError を通して error に畳む
export async function runAsyncAction(
  action: () => Promise<void>,
  onError: AsyncActionErrorHandler,
  { setBusy, setError }: AsyncActionSetters,
): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    await action();
  } catch (cause) {
    const message = onError(cause);
    if (message !== null) {
      setError(message);
    }
  } finally {
    setBusy(false);
  }
}

export interface AsyncAction {
  // 操作を走らせる。同じ描画の間は同一の関数 (useCallback の依存に入れてよい)
  run: (
    action: () => Promise<void>,
    onError: AsyncActionErrorHandler,
  ) => Promise<void>;
  busy: boolean;
  error: string | null;
  // 操作の外で文言を出す・消すとき用 (読み込み失敗・隠したときの片付けなど)
  setError: (error: string | null) => void;
}

export function useAsyncAction(): AsyncAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    (action: () => Promise<void>, onError: AsyncActionErrorHandler) =>
      runAsyncAction(action, onError, { setBusy, setError }),
    [],
  );
  return { run, busy, error, setError };
}
