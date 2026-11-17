"use client";

import { useContext, useState } from "react";
import { flushSync } from "react-dom";
import { BASE_NEW } from "@/lib/editor/saveBase";
import type { ConflictServerNote, SaveState } from "@/lib/editor/saveState";
import { SaveFormContext } from "../NoteSaveForm";
import { formOf, type ServerFollow } from "./useServerFollow";

export interface SaveConflict {
  // 見せる競合 (既に見せて閉じたものは null)
  conflict: NonNullable<SaveState> | null;
  // 「このまま上書き」で送るときだけ立てる印 (消える版を先に履歴へ刻ませる)
  checkpoint: boolean;
  onAdoptServer: () => void;
  onOverwrite: () => void;
  onSaveAsNew: () => void;
  onDismiss: () => void;
}

type ConflictDeps = Pick<
  ServerFollow,
  | "setValue"
  | "setBase"
  | "renewEditor"
  | "setServerMoved"
  | "syncedRef"
  | "markerRef"
  | "requestBaseline"
>;

// 別の版を本文として読み込む (自分の変更は捨てる)。
// 基点も一緒に差し替え、CodeMirror は作り直して undo 履歴を切る
function adoptServer(deps: ConflictDeps, server: ConflictServerNote): void {
  const nextBase = String(server.updatedAt);
  deps.setValue(server.memo);
  deps.setBase(nextBase);
  deps.renewEditor();
  deps.setServerMoved(false);
  deps.syncedRef.current = { text: server.memo, base: nextBase };
  deps.requestBaseline({ text: server.memo, base: nextBase });
}

// いま見せた版の上に自分の本文を載せて送り直す。
//
// hidden は state 制御なので flushSync で DOM へ反映してから送る
// (同期に requestSubmit すると古い基点のまま送られる)。checkpoint は
// 一発もの — 残すと次の普通の保存が自分の直前版を conflict として刻む
function resubmit(
  deps: ConflictDeps & { setCheckpoint: (on: boolean) => void },
  nextBase: string,
  withCheckpoint: boolean,
): void {
  const form = formOf(deps.markerRef);
  if (!form) {
    return;
  }
  flushSync(() => {
    deps.setBase(nextBase);
    deps.setCheckpoint(withCheckpoint);
  });
  form.requestSubmit();
  deps.setCheckpoint(false);
}

// 保存の競合 (docs/87) に対する 3 つの選び方。MemoEditor から分けた。
// deps は分けずに受ける (ref を含む入れ物の中身を描画中に読まない)
export function useSaveConflict(deps: ConflictDeps): SaveConflict {
  const [checkpoint, setCheckpoint] = useState(false);
  // 既に見せた競合の印。同じ結果に 2 度反応しない
  const [dismissedSeq, setDismissedSeq] = useState<number | null>(null);
  const saveState = useContext(SaveFormContext);
  const conflict =
    saveState !== null && saveState.seq !== dismissedSeq ? saveState : null;
  const withCheckpoint = { ...deps, setCheckpoint };

  // 押せるのは conflict を見せている間だけ (SaveConflictBanner)
  const dismiss = () => {
    if (conflict) {
      setDismissedSeq(conflict.seq);
    }
  };

  return {
    conflict,
    checkpoint,
    onAdoptServer: () => {
      if (conflict?.server) {
        adoptServer(deps, conflict.server);
      }
      dismiss();
    },
    onOverwrite: () => {
      dismiss();
      if (conflict) {
        const server = conflict.server;
        resubmit(withCheckpoint, server === null ? BASE_NEW : String(server.updatedAt), true);
      }
    },
    onSaveAsNew: () => {
      dismiss();
      resubmit(withCheckpoint, BASE_NEW, false);
    },
    onDismiss: dismiss,
  };
}
