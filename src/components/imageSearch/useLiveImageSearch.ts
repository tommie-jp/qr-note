"use client";

// 画像検索の索引を取り、カメラのフレームや写真 1 枚をそれと照合する
// (docs/25-画像検索計画.md)。埋め込みは Worker (useImageEmbedder)、照合は
// 総当たり cosine。カメラの取得は ImageSearchModal に残す (他のカメラ部品と
// まとめない。docs/93-リファクタリング計画.md §5-6)。

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { errorText } from "@/lib/errorMessage";
import { rankItems, type ImageVectorEntry, type ItemMatch } from "@/lib/imageSearch";
import { captureSquareBitmap } from "./capture";
import { fetchImageSearchIndex } from "./fetchIndex";

// 上位いくつ出すか。1 位一発当てではなく候補から選ばせる (docs/25 §6)。
const MAX_RESULTS = 5;
// ライブ検索のフレーム間隔 (ms)。約 2.5fps。詰めると推論が追いつかず詰まる。
const LIVE_INTERVAL_MS = 400;
// この類似度未満は候補に出さない。絶対値の当たりは環境依存が強いので、
// Phase 0 のスパイクで実測して詰める暫定値 (docs/25 §8)。
const MIN_SCORE = 0.15;

interface UseLiveImageSearchParams {
  // ライブ検索とシャッターがフレームを読む映像
  videoRef: RefObject<HTMLVideoElement | null>;
  embed: (bitmap: ImageBitmap) => Promise<Float32Array>;
  // カメラが映り始めたか。映るまではライブ検索を回さない
  cameraReady: boolean;
}

export interface LiveImageSearch {
  indexLoaded: boolean;
  indexError: string | null;
  matches: ItemMatch[];
  // 1 度でも照合し終えたか (「見つからず」を出すかの判定に使う)
  searched: boolean;
  live: boolean;
  // シャッター・写真で 1 枚を待たせて検索している間
  busy: boolean;
  toggleLive: () => void;
  // シャッター: いまの 1 フレームで検索
  searchCurrentFrame: () => void;
  // 写真を選んで検索。画像として読めなければ投げる (呼び手が知らせる)
  searchPhoto: (file: File) => Promise<void>;
}

export function useLiveImageSearch({
  videoRef,
  embed,
  cameraReady,
}: UseLiveImageSearchParams): LiveImageSearch {
  // 索引はレンダーに出さず、キャプチャループから読むだけなので ref に持つ
  const indexRef = useRef<ImageVectorEntry[] | null>(null);
  // 埋め込みが 1 枚処理中か (ライブ中はフレームを間引くのに使う)
  const inFlightRef = useRef(false);

  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);

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
  }, [live, cameraReady, indexLoaded, runCapture, videoRef]);

  const toggleLive = useCallback(() => setLive((v) => !v), []);

  const searchCurrentFrame = useCallback(() => {
    const video = videoRef.current;
    if (video && video.videoWidth > 0) {
      void runCapture(video, video.videoWidth, video.videoHeight, true);
    }
  }, [runCapture, videoRef]);

  // リアルタイムが重い端末・カメラ不可の逃げ道
  const searchPhoto = useCallback(
    async (file: File) => {
      setLive(false); // 写真検索に切り替える
      const bitmap = await createImageBitmap(file);
      await runCapture(bitmap, bitmap.width, bitmap.height, true);
      bitmap.close();
    },
    [runCapture],
  );

  return {
    indexLoaded,
    indexError,
    matches,
    searched,
    live,
    busy,
    toggleLive,
    searchCurrentFrame,
    searchPhoto,
  };
}
