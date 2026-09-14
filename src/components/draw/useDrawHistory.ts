"use client";

// お絵かきの取り消し履歴を fabric の canvas に結ぶ (docs/34-お絵かき計画.md §5)。
// 列の操作は純関数 (lib/draw/history.ts) に任せ、ここはシーンを JSON にして
// 積む時機と、戻すときの流し込みだけを持つ。

import type * as fabric from "fabric";
import { useCallback, useRef, useState, type RefObject } from "react";
import { SNAPSHOT_DEBOUNCE_MS } from "@/lib/draw/drawCanvasConst";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  currentEntry,
  type DrawHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/lib/draw/history";

interface UseDrawHistoryParams {
  fcRef: RefObject<fabric.Canvas | null>;
  // レイヤ状態と道具をオブジェクトのフラグへ当て直す。履歴から戻した後に呼ぶ
  applyLayerState: () => void;
  // 空判定とレイヤ別の数を出し直す。1 手積んだとき・戻したときに呼ぶ
  refreshStats: () => void;
}

export interface DrawHistoryControls {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  // 変更が落ち着いたら 1 手として積む (fabric のイベントから呼ぶ)
  scheduleSnapshot: () => void;
  // いまのシーンを起点にして履歴を作り直す (canvas を作り直した直後に呼ぶ)
  resetHistory: () => void;
  // 図形のドラッグ中は仮の図形を出し入れするので積むのを止める。
  // 再開のとき commit なら 1 手積む
  suspendSnapshots: () => void;
  resumeSnapshots: (commit: boolean) => void;
  // 予約済みのスナップショットを捨てる (canvas を捨てるときに呼ぶ)
  cancelScheduledSnapshot: () => void;
}

export function useDrawHistory({
  fcRef,
  applyLayerState,
  refreshStats,
}: UseDrawHistoryParams): DrawHistoryControls {
  // シーンを流し込んでいる間は履歴を積まない (戻した結果をまた積むと戻れなくなる)
  const suppressRef = useRef(false);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const historyRef = useRef<DrawHistory>(createHistory(""));
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const syncHistoryState = useCallback((history: DrawHistory) => {
    historyRef.current = history;
    setHistoryState({ canUndo: historyCanUndo(history), canRedo: historyCanRedo(history) });
  }, []);

  const snapshot = useCallback((): string => {
    const fc = fcRef.current;
    // layer も残す。無いと戻したときに全部がレイヤ 1 へ落ちる (docs/50 §7)
    return fc ? JSON.stringify(fc.toObject(["erasable", "layer"])) : "";
  }, [fcRef]);

  const scheduleSnapshot = useCallback(() => {
    if (suppressRef.current) {
      return;
    }
    clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      const fc = fcRef.current;
      if (!fc) {
        return;
      }
      syncHistoryState(pushHistory(historyRef.current, snapshot()));
      refreshStats();
    }, SNAPSHOT_DEBOUNCE_MS);
  }, [fcRef, snapshot, syncHistoryState, refreshStats]);

  const resetHistory = useCallback(() => {
    syncHistoryState(createHistory(snapshot()));
  }, [snapshot, syncHistoryState]);

  const suspendSnapshots = useCallback(() => {
    suppressRef.current = true;
  }, []);

  const resumeSnapshots = useCallback((commit: boolean) => {
    suppressRef.current = false;
    if (commit) {
      scheduleSnapshot();
    }
  }, [scheduleSnapshot]);

  const cancelScheduledSnapshot = useCallback(() => {
    clearTimeout(snapshotTimerRef.current);
  }, []);

  // 履歴のスナップショットを canvas へ戻す
  const applyEntry = useCallback(async (entry: string) => {
    const fc = fcRef.current;
    if (!fc || !entry) {
      return;
    }
    // 予約済みのスナップショットを捨てる。戻した結果をそのまま積み直すと
    // やり直しの先を失う
    clearTimeout(snapshotTimerRef.current);
    suppressRef.current = true;
    try {
      await fc.loadFromJSON(JSON.parse(entry));
      // 流し込んだ直後は visible/erasable/selectable が既定に戻っているので、
      // いまのレイヤ状態と道具に合わせ直す (docs/50 §3-2 の当て直し 3 箇所目)
      applyLayerState();
      refreshStats();
    } catch {
      // 壊れたスナップショットは捨てる (いまの絵はそのまま残る)
    } finally {
      suppressRef.current = false;
    }
  }, [applyLayerState, fcRef, refreshStats]);

  const undo = useCallback(() => {
    const next = undoHistory(historyRef.current);
    if (next === historyRef.current) {
      return;
    }
    syncHistoryState(next);
    void applyEntry(currentEntry(next));
  }, [applyEntry, syncHistoryState]);

  const redo = useCallback(() => {
    const next = redoHistory(historyRef.current);
    if (next === historyRef.current) {
      return;
    }
    syncHistoryState(next);
    void applyEntry(currentEntry(next));
  }, [applyEntry, syncHistoryState]);

  return {
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    undo,
    redo,
    scheduleSnapshot,
    resetHistory,
    suspendSnapshots,
    resumeSnapshots,
    cancelScheduledSnapshot,
  };
}
