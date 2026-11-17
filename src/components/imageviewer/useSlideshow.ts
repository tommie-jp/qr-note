"use client";

import { useCallback, useEffect } from "react";
import { isValidVideoName } from "@/lib/uploads/names";
import { useSlideshowInterval } from "@/lib/prefs/slideshowInterval";
import {
  neighborTarget,
  slideDelay,
  type StepPlan,
  type ViewerTarget,
} from "@/lib/images/viewerNav";
import { requestLoadMore } from "../search/loadMore";
import { playSharedVideoNow, unlockSharedVideo } from "./sharedVideo";
import { openersInPage, targetOf } from "./viewerDom";
import {
  type MediaStatus,
  nextVisit,
  type ViewerStateSetters,
} from "./useViewerState";

// 末尾で → を押してから、次のページの画像が出るのを待つ上限 (ms)
const LOAD_MORE_WAIT_MS = 15_000;
// スライドショーで、原寸が読み終わるのを待つ上限 (ms)。弱い回線で要求が
// 返らないまま止まると、消灯も抑えたまま永遠に同じ 1 枚になる。過ぎたら
// サムネのまま次へ送る
const SETTLE_WAIT_MS = 15_000;
// スライドショーで動画を見終えてから次へ送るまでの間 (ms)。終わった瞬間に
// 切り替わると、最後のコマを見る間が無い
const VIDEO_END_PAUSE_MS = 800;

// 手で送る・再生 / 一時停止
export function useViewerPlayControls({
  playing,
  advance,
  showFullscreen,
  setPlaying,
  setAwaitingMore,
}: Omit<ViewerStateSetters, "setOpened"> & {
  playing: boolean;
  advance: (dir: -1 | 1) => StepPlan["kind"] | null;
  showFullscreen: () => void;
}) {
  // 手で送る (釦・← →)。スライドショーは止める — 手で送ったのは
  // 「この 1 枚を見たい」意思なので、勝手に次へ行かない (docs/117 §3)
  const step = useCallback(
    (dir: -1 | 1) => {
      setPlaying(false);
      advance(dir);
    },
    [advance, setPlaying],
  );

  // 再生 / 一時停止。始めるときは全画面にする (ペインのまま流すと、狭い
  // ペインで眺めることになる)。止めても全画面のまま — 止めた瞬間に
  // ペインへ戻ると絵が跳ねる。再生はいま出ている 1 枚から始める
  const togglePlay = useCallback(() => {
    // 止めるときは次のページの待ちも解く。残すと、届いた瞬間に止めたはずの
    // スライドショーが 1 枚進む
    setAwaitingMore(false);
    if (playing) {
      setPlaying(false);
      return;
    }
    // 押した操作の中で、出ている動画をその場で再生する (「タップで再生」で
    // 待っている動画も流れ始める。sharedVideo.ts)
    playSharedVideoNow();
    showFullscreen();
    setPlaying(true);
  }, [playing, showFullscreen, setAwaitingMore, setPlaying]);

  return { step, togglePlay };
}

// 一覧の先頭の画像から、全画面でスライドショーを始める (docs/117 §1)
export function useStartSlideshow({
  detailItemId,
  setOpened,
  setPlaying,
  setAwaitingMore,
}: ViewerStateSetters & { detailItemId: string | null }) {
  const startSlideshow = useCallback(() => {
    const openers = openersInPage();
    if (openers.length === 0) {
      return false;
    }
    unlockSharedVideo();
    openers[0].scrollIntoView({ block: "nearest" });
    // 押した釦 (一覧の見出し行) に焦点を残すと、Space が釦を押し直して
    // 先頭から始め直してしまう
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setAwaitingMore(false);
    setOpened({
      target: targetOf(openers[0]),
      openedFor: detailItemId,
      fullscreen: true,
      visit: nextVisit(),
    });
    setPlaying(true);
    return true;
  }, [detailItemId, setAwaitingMore, setOpened, setPlaying]);
  return startSlideshow;
}

// 読み込みを待つ。一覧の DOM が変わるたびに次の画像を探し、見つかれば送る。
// 読み込んだページに画像が 1 枚も無ければ、続きがある限りもう 1 ページ頼む
// (「次の画像」はその先にある)。続きが尽きるか、待ちすぎたらあきらめる
export function useAwaitMoreResults({
  awaitingMore,
  current,
  playing,
  showTarget,
  loopToFirst,
  setAwaitingMore,
}: Pick<ViewerStateSetters, "setAwaitingMore"> & {
  awaitingMore: boolean;
  current: ViewerTarget | null;
  playing: boolean;
  showTarget: (next: ViewerTarget, openers: HTMLElement[], targets: ViewerTarget[]) => void;
  loopToFirst: () => void;
}) {
  useEffect(() => {
    if (!awaitingMore || current === null) {
      return;
    }
    // あきらめたとき、スライドショー中ならそこが末尾なので先頭へ戻る
    const giveUp = () => {
      setAwaitingMore(false);
      if (playing) {
        loopToFirst();
      }
    };
    const observer = new MutationObserver(() => {
      const openers = openersInPage();
      const targets = openers.map(targetOf);
      const next = neighborTarget(targets, current, 1);
      if (next !== null) {
        setAwaitingMore(false);
        showTarget(next, openers, targets);
      } else if (!requestLoadMore()) {
        giveUp();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(giveUp, LOAD_MORE_WAIT_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [awaitingMore, current, playing, showTarget, loopToFirst, setAwaitingMore]);
}

// 自動送り (docs/117 §2)。原寸を読み終えてから間隔を数える — 時計だけで
// 進めると、通信が遅いときサムネの引き伸ばしのまま次へ行ってしまう。
// 読み終わらないまま SETTLE_WAIT_MS 経ったらあきらめて送る。
// 次のページを待っている間は数えない (届いて送られたら、その 1 枚から数え直す)。
// 間隔を変えたら、いま出ている 1 枚の時計もその場で掛け直す
//
// 動画は間隔ではなく**再生し終えたら**送る (docs/117 §8)。長い動画も
// 最後まで見せる。再生できなかった動画 (settled) は画像と同じく間隔ぶん
// 見せて送る。再生中の動画は待つ (始まらないときは ViewerVideo が見切る)
export function useSlideshowTimer({
  playing,
  awaitingMore,
  current,
  status,
  advance,
  loopToFirst,
}: {
  playing: boolean;
  awaitingMore: boolean;
  current: ViewerTarget | null;
  status: MediaStatus;
  advance: (dir: -1 | 1) => StepPlan["kind"] | null;
  loopToFirst: () => void;
}) {
  const intervalSec = useSlideshowInterval();
  const delay =
    current === null
      ? null
      : slideDelay({
          isVideo: isValidVideoName(current.name),
          settled: status.settled,
          ended: status.ended,
          intervalMs: intervalSec * 1000,
          settleWaitMs: SETTLE_WAIT_MS,
          endPauseMs: VIDEO_END_PAUSE_MS,
        });
  useEffect(() => {
    if (!playing || awaitingMore || delay === null) {
      return;
    }
    const timer = setTimeout(() => {
      if (advance(1) === "end") {
        loopToFirst();
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [playing, delay, awaitingMore, current, advance, loopToFirst]);
}
