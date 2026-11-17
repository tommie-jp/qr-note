"use client";

import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { usePaneMode } from "@/components/panes/PaneModeProvider";
import { notePaneLayout } from "@/lib/prefs/paneMode";
import type { ViewerTarget } from "@/lib/images/viewerNav";
import type { ViewerMediaHandlers } from "./ViewerMedia";

export interface Opened {
  target: ViewerTarget;
  // 開いたときに利用者が選んでいたノート (横取りスロット。自動の先頭ノートは
  // 数えない)。これが変わったら (一覧の題を押した・「ノートを開く」)
  // 画像は用済みとして捨てる
  openedFor: string | null;
  // ペインの構成でも全画面で見たいとき (ペインの「全画面」)
  fullscreen: boolean;
  // 表示の番号。送る・開く・ペインから全画面へ移るたびに新しくなる。
  // 読み込み・再生の状態 (MediaStatus) はこの番号に結びつける — 名前で持つと、
  // 同じ動画へ戻ったときに前の「再生し終えた」が残って即座に送られる
  visit: number;
}

// いま出ている 1 枚の読み込み・再生の状態。visit が今の表示と違えば無いのと同じ
export interface MediaStatus {
  visit: number;
  // 原寸を読み終えた (読めなかった)・動画を再生できなかった
  settled: boolean;
  // 動画を再生し終えた
  ended: boolean;
}

const NO_STATUS: MediaStatus = { visit: 0, settled: false, ended: false };

// 表示の番号を振る。一意であればよいのでモジュールの外の数で足りる
let visitSeq = 0;
export function nextVisit(): number {
  visitSeq += 1;
  return visitSeq;
}

// ビューアの状態の持ち主 (ImageViewerProvider) が、送る・開く操作の
// フックへ渡す材料
export interface ViewerStateSetters {
  setOpened: Dispatch<SetStateAction<Opened | null>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setAwaitingMore: Dispatch<SetStateAction<boolean>>;
}

// 開いている 1 枚・再生中か・次のページ待ちか。どれを出しているかと、
// 覆いで出すかもここで決める
export function useViewerState(overlayOnly: boolean) {
  const { mode, detailItemId } = usePaneMode();
  const [opened, setOpened] = useState<Opened | null>(null);
  // スライドショーの再生中か (docs/117)。再生中は必ず覆いで出す
  const [playing, setPlaying] = useState(false);
  // 選んだノートが変わったら用済み。描画中に捨てる (React の
  // 「props の変化で state を直す」型) — 隠すだけにすると、前のノートへ
  // 戻った (戻る・題を押し直す) 瞬間に閉じたはずの画像が蘇る
  if (opened !== null && opened.openedFor !== detailItemId) {
    setOpened(null);
    setPlaying(false);
  }
  const visible = opened !== null && opened.openedFor === detailItemId ? opened : null;
  const current = visible?.target ?? null;
  const asOverlay =
    overlayOnly || visible?.fullscreen === true || notePaneLayout(mode) === "fullscreen";

  // 末尾で → を押し、次のページの読み込みを待っている間 true。
  // 読み込まれて画像が増えたら、その先頭へそのまま送る (useAwaitMoreResults)
  const [awaitingMore, setAwaitingMore] = useState(false);

  return {
    detailItemId,
    playing,
    current,
    asOverlay,
    visit: visible?.visit ?? 0,
    awaitingMore,
    setOpened,
    setPlaying,
    setAwaitingMore,
  };
}

// いま出ている 1 枚の読み込み・再生の状態と、それを 1 枚の部品から受け取る口
export function useViewerMedia(visit: number) {
  // いま出ている 1 枚の読み込み・再生の状態。自動送りの時間はここから決める
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>(NO_STATUS);
  // 動画を音つきで始めるか。利用者がプレーヤーで消音を切り替えたら次の
  // 動画もそれに倣う (このタブの間だけ覚える)
  const [videoSound, setVideoSound] = useState(true);
  const status = mediaStatus.visit === visit ? mediaStatus : NO_STATUS;

  // 1 枚の部品から状態を受け取る口。今の表示の番号に結びつけて記録する
  // (部品は番号ごとに作り直されるので、前の表示の知らせは混ざらない)
  const media: ViewerMediaHandlers = useMemo(
    () => ({
      visit,
      onSettled: () =>
        setMediaStatus((prev) => ({
          visit,
          settled: true,
          ended: prev.visit === visit && prev.ended,
        })),
      onVideoPlaying: () => setMediaStatus({ visit, settled: false, ended: false }),
      onVideoEnded: () =>
        setMediaStatus((prev) => ({
          visit,
          settled: prev.visit === visit && prev.settled,
          ended: true,
        })),
      videoSound,
      onVideoSoundChange: setVideoSound,
    }),
    [visit, videoSound],
  );
  return { status, media };
}
