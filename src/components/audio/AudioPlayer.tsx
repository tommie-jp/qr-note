"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { errorText } from "@/lib/errorMessage";
import {
  attachmentShareName,
  isShareAborted,
  isShareActivationLost,
  shareFile,
  shouldOfferShare,
} from "@/lib/clipboard/shareFile";
import { SECONDARY_BUTTON_CLASS } from "../ui";

interface AudioPlayerProps {
  src: string;
  // 挿入時の alt (録音の日時など)。共有ファイル名の元にする
  label: string;
}

// 取り込んだ音声のバイト列と mime。共有シートへ渡すために一度だけ取得して持つ
interface AudioBytes {
  bytes: Uint8Array;
  mime: string;
}

// 本文の音声プレイヤー + 共有ボタン。
//
// **なぜ共有ボタンが要るか**: iOS は <img> の長押しでは共有メニューを出すが、
// <audio> プレイヤーには出さない (実機で確認)。ホーム画面から起動した PWA
// (standalone) では、ノートに録った音声を Files や他アプリへ出す手段が他に
// 無くなるため、自前で口を作る (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// PDF (PdfViewerModal) の共有と同じ流儀。違いは、PDF はバイト列が表示のために
// 既に手元にあるのに対し、音声は preload="metadata" で実体を持っていない点。
//
// **transient activation の壁**: navigator.share は「ユーザー操作の直後」でないと
// 弾かれる。クリック後に fetch を挟むと通信のぶん操作から離れ、share が
// NotAllowedError になる (実際 PC Chrome で 1 回目が弾かれた)。そこで:
//   1. ボタンに触れ始めた時点 (hover / 押し始め) でバイト列を**先読み**する。
//   2. クリック時に手元にあれば、await を挟まず share を**同期で**呼ぶ
//      (activation を保つ)。録音は小さいので普通はここで 1 回で開く。
//   3. 先読みが間に合わず fetch を挟んで弾かれたら「もう一度」に変える。
//      バイト列は取れているので、2 回目は通信なし = 操作直後のまま送れる。
export function AudioPlayer({ src, label }: AudioPlayerProps) {
  // 共有が「唯一の出口」でありかつ実際に動く iOS でだけボタンを出す
  // (shouldOfferShare)。PC・Android はプレイヤーの ⋮ / 右クリックで保存でき、
  // しかも Chromium は files 付き share を恒久拒否する (clipboard/shareFile.ts)
  const canShare = useSyncExternalStore(
    () => () => {},
    () => shouldOfferShare(),
    () => false,
  );

  // 取得済みのバイト列。同期 share と再送の両方がこれを見る
  const cached = useRef<AudioBytes | null>(null);
  // 進行中の取得。二重取得を避け、クリックが先読みの完了を待てるようにする
  const loading = useRef<Promise<AudioBytes> | null>(null);
  // 'retry' … activation 切れで一度弾かれた。もう一度押せばキャッシュから送れる
  const [phase, setPhase] = useState<"idle" | "busy" | "retry">("idle");
  const [error, setError] = useState<string | null>(null);

  const loadBytes = (): Promise<AudioBytes> => {
    if (cached.current) {
      return Promise.resolve(cached.current);
    }
    loading.current ??= (async () => {
      // 同一オリジンなので Cookie は既定で付く (認証つき配信もそのまま取れる)
      const res = await fetch(src);
      if (!res.ok) {
        throw new Error(`音声を取得できませんでした (HTTP ${res.status})`);
      }
      const buffer = await res.arrayBuffer();
      const value: AudioBytes = {
        bytes: new Uint8Array(buffer),
        // 配信側が検証済みの Content-Type をそのまま使う
        mime: res.headers.get("content-type") ?? "application/octet-stream",
      };
      cached.current = value;
      return value;
    })().catch((e) => {
      // 失敗したら次の操作で取り直せるようにする (握ったままにしない)
      loading.current = null;
      throw e;
    });
    return loading.current;
  };

  // 共有の意図が見えた時点で先読みする (hover / 押し始め)。失敗は握る —
  // 本番の失敗はクリック時に出す
  const prefetch = () => {
    void loadBytes().catch(() => {});
  };

  const doShare = (data: AudioBytes): Promise<void> =>
    shareFile(data.bytes, attachmentShareName(src, label, "録音"), data.mime);

  const onShareError = (e: unknown) => {
    if (isShareAborted(e)) {
      // 共有シートを閉じただけ。バイト列は保持したまま idle に戻す
      setPhase("idle");
      return;
    }
    if (isShareActivationLost(e)) {
      // fetch で操作直後の許可が切れた。バイト列は取れているので、
      // もう一度押せば通信なしで (同期 share で) 送れる
      setPhase("retry");
      return;
    }
    setError(errorText(e));
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
    // 未取得: 取得してから共有。fetch を挟むので strict なブラウザでは
    // activation が切れうる → onShareError が「もう一度」に倒す
    loadBytes()
      .then((data) => doShare(data))
      .then(() => setPhase("idle"))
      .catch(onShareError);
  };

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        {/* autoplay は付けない。preload は metadata (開いただけで全データを取らない) */}
        <audio
          controls
          preload="metadata"
          src={src}
          className="w-full max-w-md"
        />
        {canShare && (
          <button
            type="button"
            onClick={handleShare}
            // 触れ始めた時点で先読みし、クリック時には手元にある状態にする
            onPointerEnter={prefetch}
            onPointerDown={prefetch}
            disabled={phase === "busy"}
            className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
          >
            {phase === "retry" ? "もう一度" : "共有"}
          </button>
        )}
      </span>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  );
}
