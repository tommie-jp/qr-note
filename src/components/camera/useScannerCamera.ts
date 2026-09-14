// スキャナ (ScannerModal) のカメラ操作の状態。useVideoRecording と同じ流儀で
// 「状態と操作はフックが持ち、モーダルは表示だけ」にする (docs/09-スキャン計画.md
// の Phase 2: トーチ・ズーム・内外・近接)。
//
// 録画との違い: 録画はストリームを自前 (VideoRecorder) で開くが、スキャンは
// ライブラリ <Scanner> がストリームを内部で所有する。だからここはトラックを直に
// 開かず、
//   1. constraints を state で公開し、<Scanner> に渡す (変えると開き直る) — 内外・
//      近接の切替はこの constraints の差で表す (lib/video/scannerConstraints.ts)。
//   2. ref (getStream) 越しに <Scanner> の生きているトラックを覗き、トラックが
//      入れ替わったら capability を読み直す (poll)。トーチ・ズームはそのトラックに
//      applyConstraints で直接効かせる (録画と同じ lib/video/cameraSelection.ts)。

"use client";

import type { IScannerHandle } from "@yudiel/react-qr-scanner";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  applyTorch,
  applyZoom,
  findUltraWideDeviceId,
  isFrontFacing,
  NEAR_FOCUS_ZOOM,
  readCameraCapabilities,
  zoomLevelsFor,
} from "@/lib/video/cameraSelection";
import {
  buildScannerConstraints,
  rollbackTarget,
  type ScannerCameraAim,
} from "@/lib/video/scannerConstraints";
import type { CameraFacing } from "@/lib/video/videoRecorder";

// 開き直し (constraints 変更) の後、新しいトラックが出るまでの監視間隔。
// ライブラリ既定の settleDelayMs (500ms) と同程度あれば十分。
const POLL_MS = 300;

export interface ScannerCameraState {
  // <Scanner> に渡す constraints。内外・近接の切替はこれの差で表す
  constraints: MediaTrackConstraints;
  // カメラを開けず、復帰もできなかった理由 (権限拒否など)。無いなら null。
  // **開き直しに成功したら消える** — 一度きりの失敗を出しっぱなしにしない
  error: string | null;
  // 狙いどおりに開けず退避したときの説明 (自動で畳んだ理由)。無いなら null
  note: string | null;
  // いま内側 (user) / 外側 (environment) どちらを狙っているか
  facing: CameraFacing;
  // 近接 (超広角) へ切り替えられる端末か
  canNearFocus: boolean;
  // いま近接 (超広角) を狙っているか
  nearFocus: boolean;
  // トーチ (ライト) を操作できる端末か
  canTorch: boolean;
  // いまトーチが点いているか
  torchOn: boolean;
  // 出せるズーム段階 (空ならズーム非対応)
  zoomLevels: number[];
  // いまのズーム倍率
  zoom: number;
  // 内側/外側カメラを切り替える (近接は解除される)
  toggleFacing: () => void;
  // 近接 (超広角) ⇔ 通常を切り替える
  toggleNearFocus: () => void;
  // トーチを点灯/消灯する
  toggleTorch: () => void;
  // ズーム倍率を変える
  setZoom: (value: number) => void;
  // カメラを開けなかったことを知らせる (<Scanner> の onError から呼ぶ)。
  // 最後に開けていた狙いへ戻し、戻れないときだけ message を error に出す
  notifyOpenFailed: (message: string) => void;
}

function liveVideoTrack(
  scannerRef: RefObject<IScannerHandle | null>,
): MediaStreamTrack | null {
  const track = scannerRef.current?.getStream()?.getVideoTracks()[0] ?? null;
  return track && track.readyState === "live" ? track : null;
}

export function useScannerCamera(
  scannerRef: RefObject<IScannerHandle | null>,
): ScannerCameraState {
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [nearFocus, setNearFocus] = useState(false);
  const [ultraWideId, setUltraWideId] = useState<string | null>(null);
  const [canNearFocus, setCanNearFocus] = useState(false);
  const [constraints, setConstraints] = useState<MediaTrackConstraints>(() =>
    buildScannerConstraints({
      facing: "environment",
      nearFocus: false,
      ultraWideId: null,
    }),
  );
  const [canTorch, setCanTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomLevels, setZoomLevels] = useState<number[]>([]);
  const [zoom, setZoomState] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 監視で「もう写したトラック」を覚えておき、入れ替わったときだけ読み直す
  const syncedTrackId = useRef<string | null>(null);
  // 超広角の探索を一度きりにする (権限付与後にラベルが揃ってから)
  const ultraWideProbed = useRef(false);
  // いまの狙い。state ではなく ref で持つのは、poll や <Scanner> の onError と
  // いった「レンダリングの外」から最新の値を読むため (古い closure が開き直し
  // 直後の新トラックを取りこぼすのを防ぐ)。更新は applyTarget だけが行う
  const aim = useRef<ScannerCameraAim>({
    facing: "environment",
    nearFocus: false,
  });
  // 最後に**実際に開けた**狙い。開き直しに失敗したらここへ戻る
  const lastGoodAim = useRef<ScannerCameraAim | null>(null);

  // constraints を facing / nearFocus / ultraWideId から組み立て直す。<Scanner>
  // は deepEqual で比較して、値が変わったときだけ開き直す
  const applyTarget = useCallback(
    (next: ScannerCameraAim) => {
      aim.current = next;
      setFacing(next.facing);
      setNearFocus(next.nearFocus);
      setConstraints(
        buildScannerConstraints({
          facing: next.facing,
          nearFocus: next.nearFocus,
          ultraWideId,
        }),
      );
      // ここから新しいトラックが出るまでは「写っていない」。前のカメラの
      // トーチ・ズームを出したままにすると、別のカメラのボタンを押させることに
      // なる (押しても何も起きない)。新トラックが出たら syncTrack が読み直す
      setCanTorch(false);
      setTorchOn(false);
      setZoomLevels([]);
      setZoomState(1);
      // 新しい試みの始まり。前回の知らせは畳む (必要ならこの後で出し直す)
      setNote(null);
      setError(null);
    },
    [ultraWideId],
  );

  // <Scanner> がカメラを開けなかったときに呼ぶ。狙いを先に state へ入れている
  // 都合で、失敗を放っておくと画面は真っ黒なのにボタンだけ切替後を指してしまう。
  // 最後に開けていた狙いへ戻して、表示と実物を合わせる。
  //
  // 戻れたときは赤いエラーを出さない — カメラは写っており、利用者に対処を
  // 求めることも無い。何が起きたかは note で伝える
  const notifyOpenFailed = useCallback(
    (message: string) => {
      const back = rollbackTarget(aim.current, lastGoodAim.current);
      if (!back) {
        // 戻り先が無い (初回起動の失敗など)。原因を出して対処してもらう
        setError(message);
        return;
      }
      applyTarget(back);
      setNote("そのカメラに切り替えられませんでした。元のカメラに戻します。");
    },
    [applyTarget],
  );

  const toggleFacing = useCallback(() => {
    // 内外を入れ替える。近接 (背面超広角) は外側専用なので解除する
    applyTarget({
      facing: facing === "environment" ? "user" : "environment",
      nearFocus: false,
    });
  }, [applyTarget, facing]);

  const toggleNearFocus = useCallback(() => {
    if (!ultraWideId) {
      return;
    }
    // 近接は外側の超広角。入れるときは外側に揃える
    applyTarget({ facing: "environment", nearFocus: !nearFocus });
  }, [applyTarget, nearFocus, ultraWideId]);

  // トーチ・ズームは生きているトラックへ直接効かせる (開き直さない)。失敗は
  // 握りつぶす (スキャンは続く)。適用できたときだけ state を進める
  const toggleTorch = useCallback(async () => {
    const track = liveVideoTrack(scannerRef);
    if (!track) {
      return;
    }
    const target = !torchOn;
    const ok = await applyTorch(track, target);
    if (ok) {
      setTorchOn(target);
    }
  }, [scannerRef, torchOn]);

  const setZoom = useCallback(
    async (value: number) => {
      const track = liveVideoTrack(scannerRef);
      if (!track) {
        return;
      }
      const applied = await applyZoom(track, value);
      if (applied !== null) {
        setZoomState(applied);
      }
    },
    [scannerRef],
  );

  // トラックが入れ替わったら (初回起動・内外/近接の開き直し) capability を読み直す。
  // トーチは新トラックでは消えているので off に、ズームは近接なら初期ズームをかける。
  // 近接を狙ったのに iOS が前面へ誤解決していたら畳んで外側へ戻す (メモリ参照)。
  const syncTrack = useCallback(
    async (track: MediaStreamTrack) => {
      if (!ultraWideProbed.current) {
        ultraWideProbed.current = true;
        const uw = await findUltraWideDeviceId();
        if (uw) {
          setUltraWideId(uw);
          setCanNearFocus(true);
        }
      }

      const wantNear = aim.current.nearFocus;
      if (wantNear && isFrontFacing(track)) {
        // deviceId が前面へ誤解決した (メモリ「iOS は deviceId を前面カメラに
        // 誤解決する」)。近接を諦めて外側の通常カメラへ戻す。
        //
        // **id ごと捨てて近接ボタンも畳む**。残すと押すたびに同じ誤解決を繰り返し、
        // そのたびに自撮りが一瞬映る。録画側 (videoRecorder) は exact facingMode を
        // 併記して gUM の段階で弾けるが、<Scanner> は deviceId があると facingMode を
        // 落とすため、この端末では近接を諦めるしかない
        setUltraWideId(null);
        setCanNearFocus(false);
        applyTarget({ facing: "environment", nearFocus: false });
        setNote("この端末では近接に切り替えられませんでした。");
        return;
      }

      const caps = readCameraCapabilities(track);
      setCanTorch(caps.torch);
      setTorchOn(false);
      const levels = caps.zoom ? zoomLevelsFor(caps.zoom.max) : [];
      setZoomLevels(levels);

      if (wantNear && caps.zoom) {
        const applied = await applyZoom(track, NEAR_FOCUS_ZOOM);
        setZoomState(applied ?? 1);
      } else {
        setZoomState(1);
      }

      // ここまで来たら狙いどおりのカメラが写っている。失敗したときの戻り先に
      // 控え、エラー表示も畳む — 写っているのに赤帯が残ると、直っているのに
      // 壊れて見える (一度きりの失敗が閉じるまで居座っていた)
      lastGoodAim.current = aim.current;
      setError(null);
    },
    [applyTarget],
  );

  // 生きているトラックを監視し、id が変わったら一度だけ読み直す。<Scanner> は
  // カメラ起動の完了を通知しないので poll する (軽い getStream 参照のみ)
  useEffect(() => {
    const id = window.setInterval(() => {
      const track = liveVideoTrack(scannerRef);
      if (!track || track.id === syncedTrackId.current) {
        return;
      }
      syncedTrackId.current = track.id;
      void syncTrack(track);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [scannerRef, syncTrack]);

  return {
    constraints,
    error,
    note,
    facing,
    canNearFocus,
    nearFocus,
    canTorch,
    torchOn,
    zoomLevels,
    zoom,
    toggleFacing,
    toggleNearFocus,
    toggleTorch: () => void toggleTorch(),
    setZoom: (value: number) => void setZoom(value),
    notifyOpenFailed,
  };
}
