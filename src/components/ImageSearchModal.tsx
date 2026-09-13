"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BUSY_NOTICE_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import { rankItems, type ImageVectorEntry, type ItemMatch } from "@/lib/imageSearch";
import { thumbUrl } from "@/lib/memoImages";
import { errorText } from "@/lib/errorMessage";
import { disposeOcr } from "./ocr/ocrService";
import { captureSquareBitmap } from "./imageSearch/capture";
import { fetchImageSearchIndex } from "./imageSearch/fetchIndex";
import { useImageEmbedder } from "./imageSearch/useImageEmbedder";
import { useEscapeKey } from "./modal/useEscapeKey";

// 上位いくつ出すか。1 位一発当てではなく候補から選ばせる (docs/25 §6)。
const MAX_RESULTS = 5;
// ライブ検索のフレーム間隔 (ms)。約 2.5fps。詰めると推論が追いつかず詰まる。
const LIVE_INTERVAL_MS = 400;
// この類似度未満は候補に出さない。絶対値の当たりは環境依存が強いので、
// Phase 0 のスパイクで実測して詰める暫定値 (docs/25 §8)。
const MIN_SCORE = 0.15;

// getUserMedia の失敗理由 (DOMException 名) を日本語にする。ScannerModal の
// ERROR_MESSAGES と役割は同じだが、あちらはライブラリ固有のコード、こちらは
// 素の getUserMedia の例外名なので別に持つ。
function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "カメラの使用が許可されていません。ブラウザのサイト設定でカメラを許可してください。";
    case "NotFoundError":
      return "カメラが見つかりません。";
    case "NotReadableError":
      return "他のアプリがカメラを使用中です。閉じてからもう一度お試しください。";
    case "OverconstrainedError":
      return "この端末のカメラでは条件を満たせませんでした。";
    default:
      // https でないと getUserMedia 自体が無い (docs/09 §6)
      if (typeof navigator !== "undefined" && !navigator.mediaDevices) {
        return "カメラは https でしか使えません。https でアクセスしてください。";
      }
      return "カメラを開けませんでした。";
  }
}

interface ImageSearchModalProps {
  onClose: () => void;
}

// カメラで部品を映し、登録済みノートの写真と client 側で照合する (docs/25)。
// 埋め込みは Worker、照合は総当たり cosine。リアルタイムが重い端末では
// シャッター 1 枚 (または写真選択) で検索できる。
export function ImageSearchModal({ onClose }: ImageSearchModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 索引はレンダーに出さず、キャプチャループから読むだけなので ref に持つ
  const indexRef = useRef<ImageVectorEntry[] | null>(null);
  // 埋め込みが 1 枚処理中か (ライブ中はフレームを間引くのに使う)
  const inFlightRef = useRef(false);

  // OCR の Worker を落としてメモリを空ける。編集画面の unmount でも落として
  // いる (MemoEditorInner) が、そちらに頼り切ると「落とされないまま来た」経路が
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
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);

  // Esc で閉じる (ScannerModal と同じ)
  useEscapeKey(onClose);

  // 索引の取得 (モーダルを開いた時点で 1 度)
  useEffect(() => {
    let cancelled = false;
    fetchImageSearchIndex()
      .then((entries) => {
        if (cancelled) {
          return;
        }
        indexRef.current = entries;
        setIndexLoaded(true);
        if (entries.length === 0) {
          setIndexError(
            "検索できる画像がまだありません。ノートに写真を貼るか、埋め込みの生成をお待ちください。",
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setIndexError(errorText(err, "索引を取得できませんでした"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          stream.getTracks().forEach((t) => t.stop());
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) {
        video.srcObject = null;
      }
    };
  }, []);

  // フレーム 1 枚を検索する。force=true はシャッター/写真選択 (待たせて 1 枚)。
  const runCapture = useCallback(
    async (source: ImageBitmapSource, width: number, height: number, force: boolean) => {
      const index = indexRef.current;
      if (!index || index.length === 0) {
        return;
      }
      if (inFlightRef.current && !force) {
        return; // ライブ中は 1 枚ずつ。処理中のフレームは飛ばす
      }
      inFlightRef.current = true;
      if (force) {
        setBusy(true);
      }
      try {
        const bitmap = await captureSquareBitmap(source, width, height);
        const vector = await embed(bitmap);
        setMatches(rankItems(vector, index, { limit: MAX_RESULTS, minScore: MIN_SCORE }));
        setSearched(true);
      } catch {
        // 1 枚の失敗は致命ではない (ライブなら次フレームで直る)。
        // シャッターのときだけ結果表示を「見つからず」に倒す
        if (force) {
          setMatches([]);
          setSearched(true);
        }
      } finally {
        inFlightRef.current = false;
        if (force) {
          setBusy(false);
        }
      }
    },
    [embed],
  );

  // ライブ検索ループ。カメラ・索引が揃い、live のときだけ回す。
  useEffect(() => {
    if (!live || !cameraReady || !indexLoaded) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        await runCapture(video, video.videoWidth, video.videoHeight, false);
      }
      if (!stopped) {
        timer = setTimeout(tick, LIVE_INTERVAL_MS);
      }
    };
    timer = setTimeout(tick, LIVE_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [live, cameraReady, indexLoaded, runCapture]);

  // シャッター: いまの 1 フレームで検索。
  const handleShutter = () => {
    const video = videoRef.current;
    if (video && video.videoWidth > 0) {
      void runCapture(video, video.videoWidth, video.videoHeight, true);
    }
  };

  // 写真を選んで検索 (リアルタイムが重い端末・カメラ不可の逃げ道)。
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを選び直せるように
    if (!file) {
      return;
    }
    setLive(false); // 写真検索に切り替える
    try {
      const bitmap = await createImageBitmap(file);
      await runCapture(bitmap, bitmap.width, bitmap.height, true);
      bitmap.close();
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

        {/* カメラビューと中央のガイド枠 (= 実質センタークロップ)。
            max-w を視界の高さ (dvh) でも縛るのは ScannerModal と同じ理由 —
            スマホ横持ちで映像が縦に溢れると、下のシャッターが画面外に落ちて
            スクロールしないと押せなくなる (docs/31 §12) */}
        {!error && (
          <div className="relative w-full max-w-[min(28rem,75dvh)]">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full rounded bg-black"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="aspect-square h-auto w-3/4 rounded-lg border-2 border-white/80" />
            </div>
            {preparing && (
              // カメラ映像の上に白文字だけだと埋もれて「固まった」と誤解される。
              // 初回は数十 MB のモデル取得で待ちが長いので、赤背景で明示する
              <p
                aria-live="polite"
                className={`${BUSY_NOTICE_CLASS} absolute inset-x-2 bottom-2 text-center`}
              >
                モデルを準備しています (初回のみ)…
              </p>
            )}
          </div>
        )}

        {/* 操作: シャッター / ライブ切り替え / 写真から */}
        {!error && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleShutter}
              disabled={!cameraReady || !indexLoaded || busy}
              className={PRIMARY_BUTTON_CLASS}
            >
              {busy ? "検索中…" : "この画面で検索"}
            </button>
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
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
        <div className="w-full max-w-md">
          {/* ライブ中はフレームごとに結果が入れ替わるので「見つからず」を出すと
              チラつく。シャッター/写真での確定検索のときだけ出す */}
          {searched && !live && matches.length === 0 && (
            <p className="py-4 text-center text-white/70">
              似ているノートが見つかりませんでした。
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {matches.map((m) => (
              <li key={m.itemNo}>
                <Link
                  href={`/item/${m.itemNo}`}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded bg-white/10 p-2 transition-colors active:bg-white/20"
                >
                  {/* 一覧と同じサムネ配信を使う */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbUrl(m.imageName)}
                    alt=""
                    className="h-14 w-14 flex-shrink-0 rounded object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.title}</span>
                    <span className="block text-sm text-white/60">
                      {m.itemNo}・一致度 {Math.round(m.score * 100)}%
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
