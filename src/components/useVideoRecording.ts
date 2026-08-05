// ノート編集画面の録画ボタンの状態 (docs/16-録画の近接フォーカス計画.md)。
// useAudioRecording.ts が原型。録画そのものは lib/video/videoRecorder.ts が持ち、
// ここは React 側の都合 (状態遷移・経過時間の刻み・自動停止・後始末・プレビュー
// stream の受け渡し) だけを引き受ける。
//
// 音声との違い:
//   1. 自動停止を「時間」と「推定サイズ」の早い方で行う (SIZE_STOP_MS)。
//   2. ライブプレビュー用の MediaStream を state で公開する (<video srcObject>)。
//   3. **プレビューと録画開始を分ける** (idle → preview → recording)。カメラを
//      先に開いて AF が落ち着いてから録画を始められるので、録画の頭がボケない。
//   4. カメラ操作: 近接 (超広角)・内外切替はプレビュー中のみ (トラックを開き直す)。
//      トーチ・ズームはトラックを開き直さないので録画中でも効く。

import { useCallback, useEffect, useRef, useState } from "react";
import { NEAR_FOCUS_ZOOM, zoomLevelsFor } from "@/lib/video/cameraSelection";
import {
  type CameraFacing,
  MAX_RECORDING_MS,
  SIZE_STOP_MS,
  VideoRecorder,
  type Recording,
} from "@/lib/video/videoRecorder";

// 経過時間の更新間隔。表示は秒単位なので 200ms あれば十分滑らかに見える
const TICK_MS = 200;

// 時間・サイズ上限の早い方で止める。ビットレートを上げても上限超過で録画ごと
// 失わないための保険 (videoRecorder.ts SIZE_STOP_MS のコメント)。
const AUTO_STOP_MS = Math.min(MAX_RECORDING_MS, SIZE_STOP_MS);

const AUTO_STOP_NOTE =
  AUTO_STOP_MS === MAX_RECORDING_MS
    ? `録画時間の上限 (${Math.round(MAX_RECORDING_MS / 60_000)} 分) に達したため停止しました。`
    : "ファイルサイズの上限に近づいたため停止しました。";

// idle: カメラ未使用 / preview: 開いたが未録画 / recording: 録画中
export type VideoPhase = "idle" | "preview" | "recording";

export interface VideoRecordingState {
  phase: VideoPhase;
  // 録画中か (親の busy 判定に使う。preview では false)
  isRecording: boolean;
  elapsedMs: number;
  // ライブプレビュー用の MediaStream。カメラを開いていなければ null
  previewStream: MediaStream | null;
  // エラーではないが伝えるべきこと (自動停止など)。無ければ null
  note: string | null;
  // 近接 (超広角) へ切り替えられる端末か (超広角カメラを持つ iPhone など)
  canNearFocus: boolean;
  // いま近接 (超広角) で開いているか
  nearFocus: boolean;
  // いま内側 (user) / 外側 (environment) どちらで開いているか
  facing: CameraFacing;
  // トーチ (ライト) を操作できる端末か
  canTorch: boolean;
  // いまトーチが点いているか
  torchOn: boolean;
  // 出せるズーム段階 (空ならズーム非対応)
  zoomLevels: number[];
  // いまのズーム倍率
  zoom: number;
  // idle → preview。カメラを開いてプレビューを出す
  openPreview: () => void;
  // preview → recording。プレビュー中のストリームで録画を始める
  startRecording: () => void;
  // recording → idle。録画を止めて本文へ入れる
  stop: () => void;
  // preview → idle。録画せずカメラを閉じる
  cancelPreview: () => void;
  // プレビュー中に近接 (超広角) ⇔ 通常を切り替える
  toggleNearFocus: () => void;
  // プレビュー中に内側/外側カメラを切り替える
  toggleFacing: () => void;
  // トーチを点灯/消灯する (録画中も可)
  toggleTorch: () => void;
  // ズーム倍率を変える (録画中も可)
  setZoom: (value: number) => void;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export interface VideoRecordingHandlers {
  // 録画できたものを本文へ入れる。ここが投げたら onError に回る
  onFinish: (recording: Recording) => void | Promise<void>;
  onError: (message: string) => void;
}

export function useVideoRecording(
  handlers: VideoRecordingHandlers,
): VideoRecordingState {
  const [phase, setPhase] = useState<VideoPhase>("idle");
  // 録画開始時刻。null なら録画していない (経過時間の基準を兼ねる)
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [canNearFocus, setCanNearFocus] = useState(false);
  const [nearFocus, setNearFocus] = useState(false);
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [canTorch, setCanTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomLevels, setZoomLevels] = useState<number[]>([]);
  const [zoom, setZoomState] = useState(1);
  const recorderRef = useRef<VideoRecorder | null>(null);

  // start / stop を毎レンダリング作り直さずに済ませるため、呼び先だけ差し替える
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  // 画面を離れたらカメラ・マイクを離す。開いたままの離脱で止め忘れると、
  // タブのカメラ使用中表示が残り続ける (プレビューだけでも開いていれば離す)
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
    };
  }, []);

  // カメラを閉じたときの state 後始末 (idle へ)。track は recorder 側で止める
  const resetToIdle = useCallback(() => {
    setPhase("idle");
    setStartedAt(null);
    setPreviewStream(null);
    setNearFocus(false);
    setCanNearFocus(false);
    setFacing("environment");
    setCanTorch(false);
    setTorchOn(false);
    setZoomLevels([]);
    setZoomState(1);
  }, []);

  // カメラを開き直した後、recorder の実状態を state へ写す (プレビュー・近接・
  // 内外・トーチ/ズーム対応)。トーチは新トラックでは消えているので off に、
  // ズームは近接なら初期ズームがかかっている
  const syncCameraState = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }
    setPreviewStream(recorder.stream);
    setNearFocus(recorder.nearFocus);
    setCanNearFocus(recorder.hasUltraWide);
    setFacing(recorder.facing);
    const caps = recorder.capabilities();
    setCanTorch(caps.torch);
    setTorchOn(false);
    setZoomLevels(caps.zoom ? zoomLevelsFor(caps.zoom.max) : []);
    setZoomState(recorder.nearFocus ? NEAR_FOCUS_ZOOM : 1);
  }, []);

  const openPreview = useCallback(async () => {
    recorderRef.current ??= new VideoRecorder();
    const recorder = recorderRef.current;
    if (recorder.isOpen) {
      return;
    }
    setNote(null);
    try {
      await recorder.open();
      setPhase("preview");
      // 近接可否 (hasUltraWide) も含めて recorder の実状態を写す。超広角の
      // 検出は recorder が open 時にストリームの生きているうちに済ませている
      syncCameraState();
    } catch (e) {
      handlersRef.current.onError(messageOf(e, "カメラを開けませんでした。"));
      recorder.cancel();
      resetToIdle();
    }
  }, [resetToIdle, syncCameraState]);

  const startRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder?.isOpen || recorder.isRecording) {
      return;
    }
    setNote(null);
    try {
      recorder.record();
      setElapsedMs(0);
      setStartedAt(Date.now());
      setPhase("recording");
    } catch (e) {
      handlersRef.current.onError(
        messageOf(e, "録画を開始できませんでした。"),
      );
      recorder.cancel();
      resetToIdle();
    }
  }, [resetToIdle]);

  const stop = useCallback(
    async (reason?: string) => {
      const recorder = recorderRef.current;
      if (!recorder?.isRecording) {
        return;
      }
      // 先に録画中を降ろす。経過時間の interval が畳まれ、二重停止も防げる。
      // プレビューも同時に外す (track はこの後 recorder.stop() が止める)
      resetToIdle();
      setNote(reason ?? null);
      try {
        const recording = await recorder.stop();
        await handlersRef.current.onFinish(recording);
      } catch (e) {
        handlersRef.current.onError(
          messageOf(e, "録画を保存できませんでした。"),
        );
      }
    },
    [resetToIdle],
  );

  const cancelPreview = useCallback(() => {
    const recorder = recorderRef.current;
    // 録画中は取消でなく stop を使う (録画済みを捨てさせない)
    if (!recorder?.isOpen || recorder.isRecording) {
      return;
    }
    recorder.cancel();
    resetToIdle();
    setNote(null);
  }, [resetToIdle]);

  // プレビュー中のカメラ開き直し (近接・内外) の共通処理。切替に失敗すると
  // プレビューごと畳まれている (旧トラックは停止済み) ので idle に戻す
  const reopenCamera = useCallback(
    async (action: (recorder: VideoRecorder) => Promise<void>) => {
      const recorder = recorderRef.current;
      if (!recorder?.isOpen || recorder.isRecording) {
        return;
      }
      setNote(null);
      try {
        await action(recorder);
        syncCameraState();
      } catch (e) {
        handlersRef.current.onError(
          messageOf(e, "カメラを切り替えられませんでした。"),
        );
        recorder.cancel();
        resetToIdle();
      }
    },
    [resetToIdle, syncCameraState],
  );

  const toggleNearFocus = useCallback(() => {
    void reopenCamera((recorder) =>
      recorder.switchNearFocus(!recorder.nearFocus),
    );
  }, [reopenCamera]);

  const toggleFacing = useCallback(() => {
    void reopenCamera((recorder) =>
      recorder.setFacing(
        recorder.facing === "environment" ? "user" : "environment",
      ),
    );
  }, [reopenCamera]);

  // トーチ・ズームはトラックを開き直さないので録画中でも効く。失敗は握りつぶす
  // (撮影は続く)。適用できたときだけ state を進める
  const toggleTorch = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder?.isOpen) {
      return;
    }
    const target = !torchOn;
    const ok = await recorder.setTorch(target);
    if (ok) {
      setTorchOn(target);
    }
  }, [torchOn]);

  const setZoom = useCallback(async (value: number) => {
    const recorder = recorderRef.current;
    if (!recorder?.isOpen) {
      return;
    }
    const applied = await recorder.setZoom(value);
    if (applied !== null) {
      setZoomState(applied);
    }
  }, []);

  // 経過時間を刻み、上限 (時間・サイズの早い方) で自動停止する
  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // 秒が変わったときだけ state を更新する (useAudioRecording と同旨。
      // 録画中の毎ティック再レンダリングを畳む)
      setElapsedMs((prev) =>
        Math.floor(prev / 1000) === Math.floor(elapsed / 1000) ? prev : elapsed,
      );
      if (elapsed >= AUTO_STOP_MS) {
        void stop(AUTO_STOP_NOTE);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [startedAt, stop]);

  return {
    phase,
    isRecording: phase === "recording",
    elapsedMs,
    previewStream,
    note,
    canNearFocus,
    nearFocus,
    facing,
    canTorch,
    torchOn,
    zoomLevels,
    zoom,
    openPreview: () => void openPreview(),
    startRecording,
    stop: () => void stop(),
    cancelPreview,
    toggleNearFocus,
    toggleFacing,
    toggleTorch: () => void toggleTorch(),
    setZoom: (value: number) => void setZoom(value),
  };
}
