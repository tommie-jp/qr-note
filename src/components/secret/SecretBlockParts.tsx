"use client";

import { BUSY_SPINNER_CLASS } from "@/components/ui";
import { CLIPBOARD_CLEAR_MS, type SecretMedia } from "./useSecretReveal";

// SecretBlock の描画の部品 (docs/128 §8-1 で分けた)。状態は持たない

const LINK_BUTTON_CLASS = "min-h-9 rounded px-2 text-amber-800 underline";

// 既定の「🔒 ラベル」。**中身は押すまで取りに行かない**
export function SecretPlaceholder({
  label,
  busy,
  error,
  onReveal,
}: {
  label: string;
  busy: boolean;
  error: string | null;
  onReveal: () => void;
}) {
  return (
    <span className="not-prose inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onReveal}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2.5 text-left font-medium text-amber-900 transition active:scale-95 disabled:opacity-60"
      >
        {busy ? <span aria-hidden className={BUSY_SPINNER_CLASS} /> : "🔒"}
        {label}
      </button>
      {error !== null && (
        <span className="text-sm text-red-700">{error}</span>
      )}
    </span>
  );
}

// 開いた断片の見出し行 (隠す・コピー・編集)。
// コピーと編集は文字の断片 (isText) にだけ出す
export function SecretRevealedHeader({
  label,
  isText,
  allowEdit,
  copied,
  onHide,
  onCopy,
  onEdit,
}: {
  label: string;
  isText: boolean;
  allowEdit: boolean;
  copied: boolean;
  onHide: () => void;
  onCopy: () => void;
  onEdit: () => void;
}) {
  return (
    <span className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium text-amber-900">
      🔓 {label}
      <button type="button" onClick={onHide} className={LINK_BUTTON_CLASS}>
        隠す
      </button>
      {isText && (
        <button type="button" onClick={onCopy} className={LINK_BUTTON_CLASS}>
          {copied
            ? `コピーしました (${CLIPBOARD_CLEAR_MS / 1000} 秒で消えます)`
            : "コピー"}
        </button>
      )}
      {/* 画像の断片には出さない (文字として開けない。docs/51 §9 のガードと
          同じ理由)。ラベルの変更は本文の編集なので、ここではできない */}
      {allowEdit && isText && (
        <button type="button" onClick={onEdit} className={LINK_BUTTON_CLASS}>
          編集
        </button>
      )}
    </span>
  );
}

// 断片そのものが媒体のときの描画
export function SecretMediaView({
  media,
  label,
}: {
  media: SecretMedia | null;
  label: string;
}) {
  return (
    <>
      {media?.kind === "image" && (
        /* Blob URL なので next/image の最適化 (サーバ経由) は通せない。通したら
           復号した画素がサーバへ渡ることになり、この機能の目的そのものに反する */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt={label} className="max-w-full rounded" />
      )}

      {/* 音声・動画は復号した全体を Blob で再生する。**シークできない** —
          通常の添付のような Range 配信はサーバが復号できない以上できない
          (docs/53 §2) */}
      {media?.kind === "audio" && (
        <audio controls src={media.url} className="w-full" />
      )}
      {media?.kind === "video" && (
        <video controls playsInline src={media.url} className="max-w-full rounded" />
      )}
    </>
  );
}
