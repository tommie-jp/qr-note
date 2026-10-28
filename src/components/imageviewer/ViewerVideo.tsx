"use client";

import { useEffect, useRef } from "react";
import { attachmentUrl, thumbUrl } from "@/lib/images/memoImages";

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

// ビューアの動画 1 本 (docs/117 §8)。開いたら自動で再生する。
//
// - **音つきの自動再生は拒まれることがある。** 画像を押して開いた直後は
//   利用者の操作の中なので音つきで流せるが、スライドショーが時計で送った
//   先では iOS Safari などが NotAllowedError で拒む。そのときは消音で
//   流し直す (消音の自動再生は許される)。音はプレーヤーの釦で出せる
// - playsInline は必須。iOS はこれが無いと全画面のプレーヤーへ飛ぶ (VideoPlayer と同じ)
// - 覆いは「押すと閉じる / 一時停止」なので、プレーヤーの操作は覆いへ伝えない
// - 親は relative で大きさを持つこと (ViewerImage と同じ置き方)
export function ViewerVideo({
  name,
  sound,
  onSoundChange,
  onSettled,
  onPlaying,
  onEnded,
}: ViewerVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  // 開いた時点の音の設定だけを使う。再生中に切り替わっても流し直さない
  const soundRef = useRef(sound);
  // こちらが最後に設定した muted。volumechange はこちらの設定でも飛ぶので、
  // これと違うときだけ「利用者が切り替えた」とみなす
  const expectedMutedRef = useRef(!sound);

  useEffect(() => {
    const video = ref.current;
    if (video === null) {
      return;
    }
    // 一度も流れ始めないまま待ちすぎたら見切る (利用者が止めたのとは分ける)。
    // 遅れて始まれば onPlaying が取り消す
    let started = false;
    const markStarted = () => {
      started = true;
    };
    video.addEventListener("playing", markStarted, { once: true });
    const giveUp = setTimeout(() => {
      if (!started) {
        onSettled();
      }
    }, START_WAIT_MS);

    video.muted = !soundRef.current;
    expectedMutedRef.current = video.muted;
    video
      .play()
      .catch((error: unknown) => {
        // 音つきを拒まれた → 消音で流し直す。それ以外 (中断・形式) は下へ
        if (
          error instanceof DOMException &&
          error.name === "NotAllowedError" &&
          !video.muted
        ) {
          video.muted = true;
          expectedMutedRef.current = true;
          return video.play();
        }
        throw error;
      })
      .catch((error: unknown) => {
        // 別の動画へ送って要素が外れた (AbortError) のは失敗ではない
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.warn("動画を自動で再生できませんでした", error);
        onSettled();
      });
    return () => {
      clearTimeout(giveUp);
      video.removeEventListener("playing", markStarted);
    };
    // 表示ごとに key で要素ごと作り直すので、ここは開いたときの 1 回
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <video
      ref={ref}
      src={attachmentUrl(name)}
      poster={thumbUrl(name)}
      controls
      playsInline
      preload="auto"
      aria-label="ノートの動画"
      onClick={(e) => e.stopPropagation()}
      onPlaying={() => onPlaying()}
      onEnded={() => onEnded()}
      onError={() => onSettled()}
      onVolumeChange={(e) => {
        // 自動の消音 (上の流し直し) は覚えない — 覚えると、次に画像を押して
        // 開いた (音を出せる) 動画まで消音で始まる
        const muted = e.currentTarget.muted;
        if (muted !== expectedMutedRef.current) {
          expectedMutedRef.current = muted;
          onSoundChange(!muted);
        }
      }}
      className="absolute inset-0 h-full w-full bg-black object-contain"
    />
  );
}
