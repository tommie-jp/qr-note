"use client";

import { useCallback, useEffect } from "react";
import { onPreviewPaneHidden } from "@/components/panes/previewPaneHidden";
import {
  planStep,
  sameTarget,
  type StepPlan,
  type ViewerTarget,
} from "@/lib/images/viewerNav";
import { hasMoreResults, requestLoadMore } from "../search/loadMore";
import { unlockSharedVideo } from "./sharedVideo";
import { openersInPage, targetOf } from "./viewerDom";
import { nextVisit, type ViewerStateSetters } from "./useViewerState";

// 開く・閉じる・ペインから全画面へ移す
export function useViewerOpenClose({
  detailItemId,
  asOverlay,
  setOpened,
  setPlaying,
  setAwaitingMore,
}: ViewerStateSetters & { detailItemId: string | null; asOverlay: boolean }) {
  // 開く・閉じる・送るたびに待ちは解く。残すと、閉じて別の画像を開いた後に
  // 遅れて届いたページで勝手に送られる
  // 開く・始めるのは利用者が押した処理の中なので、ここで動画の再生の
  // 許可を取っておく (sharedVideo.ts。時計で送った先の動画も流せるように)
  const open = useCallback(
    (target: ViewerTarget) => {
      unlockSharedVideo();
      setAwaitingMore(false);
      setPlaying(false);
      setOpened({
        target,
        openedFor: detailItemId,
        fullscreen: false,
        visit: nextVisit(),
      });
    },
    [detailItemId, setAwaitingMore, setPlaying, setOpened],
  );
  const close = useCallback(() => {
    setAwaitingMore(false);
    setPlaying(false);
    setOpened(null);
  }, [setAwaitingMore, setPlaying, setOpened]);
  // 境界を引き切って下のペインを隠したら閉じる (docs/86 §4-19)。
  // 閉じないと 1 ペインへ移った後に全画面の覆いとして出直す
  useEffect(() => onPreviewPaneHidden(close), [close]);
  // ペインから全画面の覆いへ移ると 1 枚を作り直す (動画は頭から流れ直す)
  // ので、表示の番号も新しくする。もう覆いなら作り直さないので番号も据え置く
  const showFullscreen = useCallback(
    () =>
      setOpened((prev) =>
        prev && !prev.fullscreen
          ? { ...prev, fullscreen: true, visit: asOverlay ? prev.visit : nextVisit() }
          : prev,
      ),
    [asOverlay, setOpened],
  );
  return { open, close, showFullscreen };
}

// 一覧の前後へ送る。手の ← → と自動送りが共有する
export function useViewerAdvance({
  current,
  setOpened,
  setPlaying,
  setAwaitingMore,
}: ViewerStateSetters & { current: ViewerTarget | null }) {
  // 送った先を出し、一覧の見える所まで寄せる — ペインの上で送っていても、
  // いまどれを見ているかが一覧の印で追える
  const showTarget = useCallback(
    (next: ViewerTarget, openers: HTMLElement[], targets: ViewerTarget[]) => {
      setOpened((prev) =>
        prev ? { ...prev, target: next, visit: nextVisit() } : prev,
      );
      openers[targets.findIndex((t) => sameTarget(t, next))]?.scrollIntoView({
        block: "nearest",
      });
    },
    [setOpened],
  );

  // 1 枚送る。並びは送る瞬間の画面から拾い直す (送っている間に次の
  // ページが継ぎ足されても、その分まで届く)。手の ← → と自動送りが共有し、
  // どうなったか (planStep) を返す。
  //
  // 次のページは**ビューアから直接頼む** (requestLoadMore)。一覧の末尾の
  // 目印はスクロールで画面に入ったときにしか読まないが、2 / 3 ペインの
  // 内側スクロールでは → で末尾の画像まで寄せても目印が器の外に隠れた
  // ままで、最後の画像で止まっていた (loadMore.ts)。末尾に近づいたら
  // 先読みし (usePreloadNeighbors)、末尾で押されたら読み込みを待ってから送る
  const advance = useCallback(
    (dir: -1 | 1): StepPlan["kind"] | null => {
      if (current === null) {
        return null;
      }
      setAwaitingMore(false);
      const openers = openersInPage();
      const targets = openers.map(targetOf);
      const plan = planStep(targets, current, dir, hasMoreResults());
      if (plan.kind === "move") {
        showTarget(plan.target, openers, targets);
      } else if (plan.kind === "wait") {
        requestLoadMore();
        setAwaitingMore(true);
      }
      return plan.kind;
    },
    [current, showTarget, setAwaitingMore],
  );

  // 自動送りが末尾 (続きのページも尽きた所) に着いたら、一覧の先頭へ戻って
  // 流し続ける (docs/117 §2)。手の ← → は今までどおり端で止まる
  // (docs/116 §4) — 回り込むのは眺めている自動送りのときだけ
  const loopToFirst = useCallback(() => {
    const openers = openersInPage();
    const targets = openers.map(targetOf);
    if (targets.length === 0) {
      setPlaying(false);
      return;
    }
    showTarget(targets[0], openers, targets);
  }, [showTarget, setPlaying]);

  return { showTarget, advance, loopToFirst };
}
