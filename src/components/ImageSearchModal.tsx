"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import { cameraErrorMessage } from "@/lib/camera/cameraErrors";
import { stopStream } from "@/lib/camera/mediaStream";
import { disposeOcr } from "./ocr/ocrService";
import { CameraViewport } from "./imageSearch/CameraViewport";
import { ImageSearchResults } from "./imageSearch/ImageSearchResults";
import { useImageEmbedder } from "./imageSearch/useImageEmbedder";
import { useLiveImageSearch } from "./imageSearch/useLiveImageSearch";
import { useEscapeKey } from "./modal/useEscapeKey";

interface ImageSearchModalProps {
  onClose: () => void;
}

// カメラで部品を映し、登録済みノートの写真と client 側で照合する (docs/25)。
// 埋め込みは Worker、照合は総当たり cosine (useLiveImageSearch)。リアルタイムが
// 重い端末ではシャッター 1 枚 (または写真選択) で検索できる。
export function ImageSearchModal({ onClose }: ImageSearchModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // OCR の Worker を落としてメモリを空ける。編集画面の unmount でも落として
  // いる (editor/hooks/useEditorOcr.ts) が、そちらに頼り切ると「落とされないまま来た」経路が
  // 1 つでもあれば元のメモリ不足がそのまま再現する。メモリを必要とする側が
  // 自分で要求しておく。
  //
  // **useImageEmbedder より前に置くこと**: effect は登録順に走るので、ここが
  // 後ろだと埋め込み Worker がモデルを取り始めた後に解放することになる。
  // 空けてから積むためにこの位置に置いてある
  useEffect(() => {
    disposeOcr("画像検索を開く");
  }, []);

  const {
    ready: modelReady,
    failed: modelFailed,
    failureMessage: modelFailureMessage,
    embed,
  } = useImageEmbedder();

  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc で閉じる (ScannerModal と同じ)
  useEscapeKey(onClose);

  // 索引の取得 (開いた時点で 1 度) とライブ検索ループ
  const {
    indexLoaded,
    indexError,
    matches,
    searched,
    live,
    busy,
    toggleLive,
    searchCurrentFrame,
    searchPhoto,
  } = useLiveImageSearch({ videoRef, embed, cameraReady });

  // カメラ起動と後始末
  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(cameraErrorMessage(new DOMException("", "NotFoundError")));
        return;
      }
      try {
        // 背面カメラを優先 (部品を映すので)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {
            // 自動再生が拒否されても、後の操作 (タップ) で再生されうる
          });
        }
        setCameraReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(cameraErrorMessage(err));
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
      if (video) {
        video.srcObject = null;
      }
    };
  }, []);

  // 写真を選んで検索 (リアルタイムが重い端末・カメラ不可の逃げ道)。
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを選び直せるように
    if (!file) {
      return;
    }
    try {
      await searchPhoto(file);
    } catch {
      setError("画像を読み込めませんでした。");
    }
  };

  // 読み込みに失敗したら準備バナーは畳む (エラーと「準備しています」が並ぶと
  // まだ待てば直ると誤解される)
  const preparing =
    !modelReady && !modelFailed && (busy || (live && cameraReady && indexLoaded));

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white">
      <div className="flex items-center justify-between p-3">
        <span>部品をかざして画像検索</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-white/20 px-4 py-2 font-medium"
          aria-label="画像検索を閉じる"
        >
          閉じる
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center gap-3 overflow-y-auto p-4">
        {error && (
          <p
            role="alert"
            className="max-w-sm rounded bg-red-900/80 px-3 py-2 text-center"
          >
            {error}
          </p>
        )}
        {indexError && (
          <p
            role="alert"
            className="max-w-sm rounded bg-amber-900/80 px-3 py-2 text-center"
          >
            {indexError}
          </p>
        )}
        {modelFailed && (
          <p
            role="alert"
            className="max-w-sm rounded bg-red-900/80 px-3 py-2 text-center"
          >
            画像検索モデルを読み込めませんでした。通信環境を確認するか、端末のメモリが
            足りていない可能性があるので他のタブ・アプリを閉じて開き直してください。
            {/* 通信以外の原因 (端末のメモリ不足、配布アセットの欠落など) もあるので
                理由を添える。英語のままで読みにくいが、無いと原因に辿り着けない */}
            {modelFailureMessage && (
              <span className="mt-1 block break-all text-sm text-white/70">
                {modelFailureMessage}
              </span>
            )}
          </p>
        )}

        {/* カメラビューと中央のガイド枠 */}
        {!error && <CameraViewport videoRef={videoRef} preparing={preparing} />}

        {/* 操作: シャッター / ライブ切り替え / 写真から */}
        {!error && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={searchCurrentFrame}
              disabled={!cameraReady || !indexLoaded || busy}
              className={PRIMARY_BUTTON_CLASS}
            >
              {busy ? "検索中…" : "この画面で検索"}
            </button>
            <button
              type="button"
              onClick={toggleLive}
              className={SECONDARY_BUTTON_CLASS}
              aria-pressed={live}
            >
              {live ? "ライブ検索: オン" : "ライブ検索: オフ"}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={SECONDARY_BUTTON_CLASS}
            >
              写真から
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
            />
          </div>
        )}

        {/* 結果 */}
        <ImageSearchResults
          matches={matches}
          searched={searched}
          live={live}
          onSelect={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
