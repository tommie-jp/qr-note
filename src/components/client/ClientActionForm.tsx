"use client";

import type { ReactNode } from "react";
import {
  backfillHistoryAction,
  commitNoteAction,
  restoreNoteVersionAction,
} from "@/lib/client/actions";

// サーバ描画のまま残る画面 (履歴・設定) の form を端末側の action へ送る
// (docs/123 §4-3)。サーバの部品は端末の関数を props で渡せないので、名前で選ぶ
const ACTIONS = {
  commitNote: commitNoteAction,
  restoreNoteVersion: restoreNoteVersionAction,
  backfillHistory: backfillHistoryAction,
} as const;

export type ClientActionName = keyof typeof ACTIONS;

export function ClientActionForm({
  action,
  className,
  children,
}: {
  action: ClientActionName;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form action={ACTIONS[action]} className={className}>
      {children}
    </form>
  );
}
