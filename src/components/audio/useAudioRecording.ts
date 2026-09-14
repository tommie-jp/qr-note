// ノート編集画面の録音ボタンの状態 (41-QR-search/docs/12「ノート内録音の実装計画」)。
//
// 録音そのものは lib/audio/audioRecorder.ts が持ち、ここは React 側の都合
// (経過時間の刻み・自動停止・後始末) だけを引き受ける。MemoEditorInner が
// 既に大きいので、録音の状態機械はこちらへ分ける。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioRecorder,
  MAX_RECORDING_MS,
  type Recording,
} from "@/lib/audio/audioRecorder";
import { errorText } from "@/lib/errorMessage";
import { useLatest } from "../hooks/useLatest";

// 経過時間の更新間隔。表示は秒単位なので 200ms あれば十分滑らかに見える
const TICK_MS = 200;

const AUTO_STOP_NOTE = `録音時間の上限 (${MAX_RECORDING_MS / 60_000} 分) に達したため停止しました。`;

export interface AudioRecordingState {
  isRecording: boolean;
  elapsedMs: number;
  // エラーではないが伝えるべきこと (自動停止など)。無ければ null
  note: string | null;
  toggle: () => void;
}

export interface AudioRecordingHandlers {
  // 録音できたものを本文へ入れる。ここが投げたら onError に回る
  onFinish: (recording: Recording) => void | Promise<void>;
  onError: (message: string) => void;
}

export function useAudioRecording(
  handlers: AudioRecordingHandlers,
): AudioRecordingState {
  // 録音開始時刻。null なら録音していない (経過時間の基準も兼ねる)
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  // start / stop を毎レンダリング作り直さずに済ませるため、呼び先だけ差し替える。
  // (作り直すと経過時間の interval を毎回張り直すことになる)
  const handlersRef = useLatest(handlers);

  // 画面を離れたらマイクを離す。録音したままの離脱で止め忘れると、
  // タブのマイク使用中表示が残り続ける
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
    };
  }, []);

  const start = useCallback(async () => {
    recorderRef.current ??= new AudioRecorder();
    setNote(null);
    try {
      await recorderRef.current.start();
      setElapsedMs(0);
      // 開始できてから録音中にする。失敗したまま「録音中」を出さない
      setStartedAt(Date.now());
    } catch (e) {
      handlersRef.current.onError(errorText(e, "録音を開始できませんでした。"));
    }
  }, [handlersRef]);

  const stop = useCallback(async (reason?: string) => {
    const recorder = recorderRef.current;
    if (!recorder?.isRecording) {
      return;
    }
    // 先に録音中を降ろす。経過時間の interval が畳まれ、二重停止も防げる
    setStartedAt(null);
    setNote(reason ?? null);
    try {
      const recording = await recorder.stop();
      await handlersRef.current.onFinish(recording);
    } catch (e) {
      handlersRef.current.onError(errorText(e, "録音を保存できませんでした。"));
    }
  }, [handlersRef]);

  // 経過時間を刻み、上限で自動停止する。上限を超えた分はアップロードで
  // 断られて録音ごと失われるので、その手前で確実に止める
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // 刻みは 200ms のまま (自動停止の遅れを 200ms 以内に抑えるため) だが、
      // **state は秒が変わったときだけ更新する**。表示は秒単位なので、
      // 5 回に 4 回は同じ文字列にしかならない。同じ値を返せば React は
      // 再レンダリングを畳む — ここを素通しにすると、録音中ずっと編集画面
      // 全体が毎秒 5 回描き直される
      setElapsedMs((prev) =>
        Math.floor(prev / 1000) === Math.floor(elapsed / 1000) ? prev : elapsed,
      );
      if (elapsed >= MAX_RECORDING_MS) {
        void stop(AUTO_STOP_NOTE);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [startedAt, stop]);

  const toggle = useCallback(() => {
    void (recorderRef.current?.isRecording ? stop() : start());
  }, [start, stop]);

  return { isRecording: startedAt !== null, elapsedMs, note, toggle };
}
