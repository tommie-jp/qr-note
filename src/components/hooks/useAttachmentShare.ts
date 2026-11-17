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

// 取り込んだ添付のバイト列と mime。共有シートへ渡すために一度だけ取得して持つ
interface AttachmentBytes {
  bytes: Uint8Array;
  mime: string;
}

interface AttachmentShareOptions {
  src: string;
  // 挿入時の alt (録音・録画の日時など)。共有ファイル名の元にする
  label: string;
  // alt が無いときのファイル名 ("録音" / "録画")
  fallbackName: string;
  // 取得に失敗したときの断りに出す種類 ("音声" / "動画")
  kindLabel: string;
}

// 本文の音声・動画プレイヤーの共有ボタンの中身 (AudioPlayer・VideoPlayer が共有)。
//
// **transient activation の壁**: navigator.share は「ユーザー操作の直後」でないと
// 弾かれる。クリック後に fetch を挟むと通信のぶん操作から離れ、share が
// NotAllowedError になる (実際 PC Chrome で 1 回目が弾かれた)。そこで:
//   1. ボタンに触れ始めた時点でバイト列を**先読み**する (prefetch。いつ呼ぶかは
//      呼び手が決める — 動画は重いので hover では呼ばない)。
//   2. クリック時に手元にあれば、await を挟まず share を**同期で**呼ぶ
//      (activation を保つ)。
//   3. 先読みが間に合わず fetch を挟んで弾かれたら「もう一度」に変える。
//      バイト列は取れているので、2 回目は通信なし = 操作直後のまま送れる。
export function useAttachmentShare({ src, label, fallbackName, kindLabel }: AttachmentShareOptions) {
  // 共有が「唯一の出口」でありかつ実際に動く iOS でだけボタンを出す
  // (shouldOfferShare)。PC・Android はプレイヤーの ⋮ / 右クリックで保存でき、
  // しかも Chromium は files 付き share を恒久拒否する (clipboard/shareFile.ts)
  const canShare = useSyncExternalStore(
    () => () => {},
    () => shouldOfferShare(),
    () => false,
  );

  const { cached, loadBytes } = useBytesCache(src, kindLabel);
  // 'retry' … activation 切れで一度弾かれた。もう一度押せばキャッシュから送れる
  const [phase, setPhase] = useState<"idle" | "busy" | "retry">("idle");
  const [error, setError] = useState<string | null>(null);

  // 共有の意図が見えた時点で先読みする。失敗は握る — 本番の失敗はクリック時に出す
  const prefetch = () => {
    void loadBytes().catch(() => {});
  };

  const doShare = (data: AttachmentBytes): Promise<void> =>
    shareFile(data.bytes, attachmentShareName(src, label, fallbackName), data.mime);

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

  return { canShare, phase, error, prefetch, handleShare };
}

// 添付のバイト列を 1 度だけ取って手元に持つ
function useBytesCache(src: string, kindLabel: string) {
  // 取得済みのバイト列。同期 share と再送の両方がこれを見る
  const cached = useRef<AttachmentBytes | null>(null);
  // 進行中の取得。二重取得を避け、クリックが先読みの完了を待てるようにする
  const loading = useRef<Promise<AttachmentBytes> | null>(null);

  const loadBytes = (): Promise<AttachmentBytes> => {
    if (cached.current) {
      return Promise.resolve(cached.current);
    }
    loading.current ??= (async () => {
      const value = await fetchBytes(src, kindLabel);
      cached.current = value;
      return value;
    })().catch((e) => {
      // 失敗したら次の操作で取り直せるようにする (握ったままにしない)
      loading.current = null;
      throw e;
    });
    return loading.current;
  };
  return { cached, loadBytes };
}

// 同一オリジンなので Cookie は既定で付く (認証つき配信もそのまま取れる)
async function fetchBytes(src: string, kindLabel: string): Promise<AttachmentBytes> {
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`${kindLabel}を取得できませんでした (HTTP ${res.status})`);
  }
  const buffer = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    // 配信側が検証済みの Content-Type をそのまま使う
    mime: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
