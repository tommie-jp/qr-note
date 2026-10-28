"use client";

import { useEffect, useRef, useState } from "react";
import { attachmentUrl, thumbUrl } from "@/lib/images/memoImages";
import { sharedVideo } from "./sharedVideo";

// 再生が始まらないまま (読み込みが返らない・形式を再生できない) これだけ
// 経ったら、読めなかったものとして親へ知らせる (スライドショーを止めない)
const START_WAIT_MS = 15_000;

interface ViewerVideoProps {
  name: string;
  // 音を出して再生するか。ブラウザが音つきの自動再生を拒んだら消音で流し直す
  sound: boolean;
  // 利用者がプレーヤーで消音を切り替えた (次の動画もそれに倣う)
  onSoundChange: (sound: boolean) => void;
  // 再生できなかった (エラー・始まらない)。スライドショーは間隔ぶん見せて次へ
  onSettled: () => void;
  // 流れ始めた (遅れて始まった・やり直した)。「再生できなかった」を取り消す
  onPlaying: () => void;
  // 再生し終えた。スライドショーは次へ
  onEnded: () => void;
}

type Handlers = Omit<ViewerVideoProps, "name">;

function isDomError(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name;
}

// ビューアの動画 1 本 (docs/117 §8)。開いたら自動で再生する。
//
// **<video> は描かず、ビューアが持つ 1 つの要素を器へ差し込む** (sharedVideo.ts)。
// iOS Safari は、利用者の操作の中で一度 play() / load() された要素なら、
// 以後は時計から再生しても許す。動画ごとに要素を作ると、スライドショーが
// 時計で送った先は毎回「操作なしの再生」になり、音つきは拒まれ、低電力
// モードでは消音まで拒まれて飛ばされていた (2026-10-28 報告。docs/117 §8-4)。
//
// - 音つきを拒まれたら消音で流し直す
// - 消音でも拒まれたら (許可を取れていない) **飛ばさずに待つ**。「タップで
//   再生」と出し、利用者がプレーヤー・▶・Space で再生すれば流れ始める
// - 形式・通信のエラーと、15 秒たっても始まらないものは onSettled (次へ送る)
// - 覆いは「押すと閉じる / 一時停止」なので、プレーヤーの操作は覆いへ伝えない
// - 親は relative で大きさを持つこと
// - ビューアは表示ごとに key で作り直す (ViewerMedia)。要素は使い回すので、
//   外した後に届いた前の表示の知らせ (play() の失敗など) は捨てる
export function ViewerVideo({ name, ...handlers }: ViewerVideoProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 自動再生を拒まれ、利用者の操作を待っている
  const [blocked, setBlocked] = useState(false);
  // 知らせ先は描くたびに最新へ差し替え、要素のイベントからはここを読む
  const handlersRef = useRef<Handlers>(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) {
      return;
    }
    const video = sharedVideo();
    // 外した後 (別の動画へ送った) に届く知らせを捨てる
    let alive = true;
    const notify = (pick: (h: Handlers) => void) => {
      if (alive) {
        pick(handlersRef.current);
      }
    };

    video.poster = thumbUrl(name);
    video.src = attachmentUrl(name);
    // 前の動画で変えた再生速度は持ち越さない (音量はプレーヤーの好みとして残す)
    video.playbackRate = 1;
    video.muted = !handlersRef.current.sound;
    // こちらが最後に設定した muted。volumechange はこちらの設定でも飛ぶので、
    // これと違うときだけ「利用者が切り替えた」とみなす
    let expectedMuted = video.muted;
    box.appendChild(video);

    // 一度も流れ始めないまま待ちすぎたら見切る (利用者が止めたのとは分ける)。
    // 自動再生を拒まれてタップを待っているときは見切らない
    let started = false;
    let waitingForTap = false;
    const giveUp = setTimeout(() => {
      if (!started && !waitingForTap) {
        notify((h) => h.onSettled());
      }
    }, START_WAIT_MS);

    const handlePlaying = () => {
      started = true;
      waitingForTap = false;
      setBlocked(false);
      notify((h) => h.onPlaying());
    };
    const handleEnded = () => notify((h) => h.onEnded());
    const handleError = () => notify((h) => h.onSettled());
    const handleVolume = () => {
      if (video.muted !== expectedMuted) {
        expectedMuted = video.muted;
        notify((h) => h.onSoundChange(!video.muted));
      }
    };
    const stopClick = (event: MouseEvent) => event.stopPropagation();
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    video.addEventListener("volumechange", handleVolume);
    video.addEventListener("click", stopClick);

    video
      .play()
      .catch((error: unknown) => {
        // 音つきを拒まれた → 消音で流し直す。それ以外 (中断・形式) は下へ。
        // もう外した要素 (次の動画のもの) には触らない
        if (alive && isDomError(error, "NotAllowedError") && !video.muted) {
          video.muted = true;
          expectedMuted = true;
          return video.play();
        }
        throw error;
      })
      .catch((error: unknown) => {
        // 外した後の失敗・別の動画へ送って中断した (AbortError) のは失敗ではない
        if (!alive || isDomError(error, "AbortError")) {
          return;
        }
        if (isDomError(error, "NotAllowedError")) {
          // 消音でも拒まれた (低電力モードなど)。飛ばさずにタップを待つ
          waitingForTap = true;
          setBlocked(true);
          return;
        }
        console.warn("動画を自動で再生できませんでした", error);
        notify((h) => h.onSettled());
      });

    return () => {
      alive = false;
      clearTimeout(giveUp);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeEventListener("volumechange", handleVolume);
      video.removeEventListener("click", stopClick);
      video.pause();
      // 読み込みを止めて外す。要素は次の動画で使い回す (許可は要素に残る)
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.load();
      video.remove();
    };
  }, [name]);

  return (
    <div ref={boxRef} className="absolute inset-0">
      {blocked && (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 top-4 z-10 mx-auto w-fit rounded bg-black/70 px-3 py-1 text-sm text-white"
        >
          タップで再生
        </p>
      )}
    </div>
  );
}
