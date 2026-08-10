"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  attachmentShareName,
  isShareAborted,
  isShareActivationLost,
  shareFile,
  shouldOfferShare,
} from "@/lib/shareFile";
import { SECONDARY_BUTTON_CLASS } from "../ui";

interface VideoPlayerProps {
  src: string;
  // 挿入時の alt (録画の日時など)。共有ファイル名の元にする。
  // 幅記法 (`![録画|300]`) は MarkdownView 側で剥がしてから渡す
  label: string;
  // 本文の幅記法で指定された表示幅 (px)。null なら既定の上限のまま
  // (docs/73-動画幅指定計画.md)
  width?: number | null;
}

// 取り込んだ動画のバイト列と mime。共有シートへ渡すために一度だけ取得して持つ
interface VideoBytes {
  bytes: Uint8Array;
  mime: string;
}

// 本文の動画プレイヤー + 共有ボタン (docs/14-動画挿入計画.md)。
//
// AudioPlayer.tsx の鏡写し。違いは 2 つ:
//   1. <video> を使い、poster に配信の ?thumb=1 (クライアント生成 WebP) を渡す。
//      サムネが無ければ配信側が 404 を返し、ブラウザは poster を無視する。
//   2. **hover では先読みしない。** 動画は数十 MB になりうるので、触れただけで
//      落とすのは重い。共有はボタンを押した時点で取得し、activation が切れたら
//      「もう一度」で通信なしに送る (AudioPlayer と同じ retry 経路)。
//
// **playsInline は必須** — iOS はこれが無いと再生時に全画面へ遷移し、
// standalone PWA でノートへ戻れなくなる。
export function VideoPlayer({ src, label, width = null }: VideoPlayerProps) {
  // 共有が「唯一の出口」でありかつ実際に動く iOS でだけボタンを出す
  // (shouldOfferShare)。PC・Android はプレイヤーの ⋮ / 右クリックで保存でき、
  // しかも Chromium は files 付き share を恒久拒否する (shareFile.ts)
  const canShare = useSyncExternalStore(
    () => () => {},
    () => shouldOfferShare(),
    () => false,
  );

  const cached = useRef<VideoBytes | null>(null);
  const loading = useRef<Promise<VideoBytes> | null>(null);
  const [phase, setPhase] = useState<"idle" | "busy" | "retry">("idle");
  const [error, setError] = useState<string | null>(null);

  const loadBytes = (): Promise<VideoBytes> => {
    if (cached.current) {
      return Promise.resolve(cached.current);
    }
    loading.current ??= (async () => {
      // 同一オリジンなので Cookie は既定で付く (認証つき配信もそのまま取れる)
      const res = await fetch(src);
      if (!res.ok) {
        throw new Error(`動画を取得できませんでした (HTTP ${res.status})`);
      }
      const buffer = await res.arrayBuffer();
      const value: VideoBytes = {
        bytes: new Uint8Array(buffer),
        mime: res.headers.get("content-type") ?? "application/octet-stream",
      };
      cached.current = value;
      return value;
    })().catch((e) => {
      loading.current = null;
      throw e;
    });
    return loading.current;
  };

  // 共有ボタンを押し始めた時点で先読みする (hover では落とさない — 動画は重い)
  const prefetch = () => {
    void loadBytes().catch(() => {});
  };

  const doShare = (data: VideoBytes): Promise<void> =>
    shareFile(data.bytes, attachmentShareName(src, label, "録画"), data.mime);

  const onShareError = (e: unknown) => {
    if (isShareAborted(e)) {
      setPhase("idle");
      return;
    }
    if (isShareActivationLost(e)) {
      // fetch で操作直後の許可が切れた。バイト列は取れているので、
      // もう一度押せば通信なしで (同期 share で) 送れる
      setPhase("retry");
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
    setPhase("idle");
  };

  const handleShare = () => {
    setError(null);
    setPhase("busy");
    if (cached.current) {
      // 手元にある: await を挟まず同期で share を呼ぶ (activation を保つ)
      doShare(cached.current)
        .then(() => setPhase("idle"))
        .catch(onShareError);
      return;
    }
    loadBytes()
      .then((data) => doShare(data))
      .then(() => setPhase("idle"))
      .catch(onShareError);
  };

  // ダウンロード時のファイル名 (UUID のままでは何か判らないので、録画日時 +
  // 保存拡張子に直す。共有シートのファイル名と揃える)
  const downloadName = attachmentShareName(src, label, "録画");

  // **書き出しの操作は動画の下に置く。** 横に並べると、<video> は w-full で
  // フレックス内で縮まず (intrinsic min-width)、iPhone の細い画面ではボタンが
  // 画面外へ押し出されて「共有ボタンが無い」ように見える (実機で判明)。
  return (
    <span className="flex flex-col gap-1">
      {/* preload は metadata (開いただけで全データを取らない)。poster は
          クライアント生成の WebP (?thumb=1)。無ければ配信が 404 → 無視される。
          幅記法 (![録画|300]) は**固定幅ではなく上限**にする — <video> は
          既定で全幅に伸びる部品なので、画面より広い指定を固定幅にすると
          iPhone で横スクロールが生える (docs/73-動画幅指定計画.md §2)。
          既定の max-w-md (448px) を指定値で差し替えるだけ、という形 */}
      <video
        controls
        playsInline
        preload="metadata"
        poster={`${src}?thumb=1`}
        src={src}
        className={width === null ? "w-full max-w-md rounded" : "w-full rounded"}
        style={width === null ? undefined : { maxWidth: width }}
      />
      <span className="flex items-center gap-2">
        {canShare ? (
          // iOS: <video> には長押し共有もダウンロードも無いので、共有シートを出す
          <button
            type="button"
            onClick={handleShare}
            onPointerDown={prefetch}
            disabled={phase === "busy"}
            className={SECONDARY_BUTTON_CLASS}
          >
            {phase === "retry" ? "もう一度" : "共有"}
          </button>
        ) : (
          // iOS 以外: files 付き share は Windows で恒久拒否 (shareFile.ts) なので
          // 使わず、素直なダウンロードリンクにする。プレイヤーの ⋮ からも保存
          // できるが、明示ボタンがある方が判りやすい (Android にも口ができる)。
          // 同一オリジンなので download 属性でそのまま保存できる
          <a
            href={src}
            download={downloadName}
            className={SECONDARY_BUTTON_CLASS}
          >
            保存
          </a>
        )}
      </span>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  );
}
