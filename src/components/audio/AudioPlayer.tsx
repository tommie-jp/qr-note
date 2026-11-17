"use client";

import { useAttachmentShare } from "@/components/hooks/useAttachmentShare";
import { SECONDARY_BUTTON_CLASS } from "../ui";

interface AudioPlayerProps {
  src: string;
  // 挿入時の alt (録音の日時など)。共有ファイル名の元にする
  label: string;
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
  // 共有の中身 (先読み・同期 share・「もう一度」) は useAttachmentShare が持つ。
  // 音声は小さいので hover でも先読みする
  const { canShare, phase, error, prefetch, handleShare } = useAttachmentShare({
    src,
    label,
    fallbackName: "録音",
    kindLabel: "音声",
  });

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
