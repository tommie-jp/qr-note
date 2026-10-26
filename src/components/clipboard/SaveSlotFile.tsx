"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { ClipboardDownIcon } from "@/components/icons";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";
import { createSlotBytesLoader, SERVER_CLIPBOARD_DATA_URL } from "@/lib/clipboard/serverClipboard";
import { isShareAborted, isShareActivationLost, shareFile, shouldOfferShare } from "@/lib/clipboard/shareFile";
import { type ClipboardSlotMeta, slotFileName } from "@/lib/clipboard/slot";
import { errorText } from "@/lib/errorMessage";

// サーバの枠のファイルを端末に残す (保存・共有) 部品。
//
// **iPhone ではリンクにしない。** download 属性つきのリンクは、ホーム画面から起動した
// PWA (standalone) では効かず、動画ファイルそのものへ同じ画面で遷移してしまう。
// standalone には戻るボタンが無いので、アプリへ戻れなくなる (実機で判明)。
// iOS では共有シートが唯一の出口で、閉じれば PWA に戻る (clipboard/shareFile.ts)。
// 動画プレイヤーの共有と同じ二段構えにする:
//   1 回目 … 押した時点で取得 (取れたらそのまま共有。許可が切れたら「もう一度」)
//   2 回目 … 手元のバイト列を同期で共有に渡す (通信を挟まない)
// PC・Android は files 付き share が使えない・要らないので、従来どおり download リンク。
//
// 呼ぶ側は key={slot.updatedAt} を付けて、枠が置き換わったら取得済みを捨てること。

type Phase = "idle" | "busy" | "retry";

interface SaveSlotFileProps {
  readonly slot: ClipboardSlotMeta;
  readonly now: Date;
  // row … メニューの 1 行 (右に概要を出す)。small … 消すの隣の小さな文字
  readonly variant: "row" | "small";
  // row のときの右側の概要 (「動画 12.3MB・3 分前」)
  readonly summary?: string;
}

const SMALL_CLASS = "flex min-h-8 shrink-0 items-center px-2 text-sm font-medium text-sky-700";

export function SaveSlotFile({ slot, now, variant, summary }: SaveSlotFileProps) {
  // 共有が唯一の出口で、実際に動く iOS でだけ共有にする。サーバ描画では false
  // (水和ずれを避ける。VideoPlayer と同じ)
  const useShare = useSyncExternalStore(
    () => () => {},
    () => shouldOfferShare(),
    () => false,
  );
  const loader = useRef(createSlotBytesLoader());
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileName = slotFileName(slot, now);

  const doShare = (data: { bytes: Uint8Array; mime: string }) =>
    shareFile(data.bytes, fileName, data.mime);

  const onShareError = (cause: unknown) => {
    if (isShareAborted(cause)) {
      // 共有シートを閉じただけ。失敗ではない
      setPhase("idle");
      return;
    }
    if (isShareActivationLost(cause)) {
      // 取得で操作直後の許可が切れた。バイト列は取れているので、もう一度押せば
      // 通信なしで共有できる
      setPhase("retry");
      return;
    }
    console.error("サーバのファイルを共有できませんでした:", cause);
    setError(errorText(cause));
    setPhase("idle");
  };

  const share = () => {
    setError(null);
    setPhase("busy");
    const cached = loader.current.cached();
    if (cached) {
      // 手元にある: await を挟まず同期で share を呼ぶ (許可を保つ)
      doShare(cached)
        .then(() => setPhase("idle"))
        .catch(onShareError);
      return;
    }
    loader.current
      .load()
      .then(doShare)
      .then(() => setPhase("idle"))
      .catch(onShareError);
  };

  // 押し始めた時点で先読みする (hover では落とさない — 動画は重い)
  const prefetch = () => {
    void loader.current.load().catch(() => {});
  };

  const label = phase === "retry" ? "もう一度" : phase === "busy" ? "取得しています…" : null;

  const control = useShare ? (
    <button
      type="button"
      onClick={share}
      onPointerDown={prefetch}
      disabled={phase === "busy"}
      className={
        variant === "row"
          ? `${HEADER_MENU_ITEM_CLASS} justify-between disabled:opacity-60`
          : `${SMALL_CLASS} disabled:opacity-60`
      }
    >
      {variant === "row" ? (
        <>
          <span className="flex items-center gap-2 whitespace-nowrap">
            <ClipboardDownIcon />
            {label ?? "サーバから共有"}
          </span>
          <span className="shrink-0 text-xs font-normal text-gray-500">{summary}</span>
        </>
      ) : (
        (label ?? "共有")
      )}
    </button>
  ) : variant === "row" ? (
    <a
      href={SERVER_CLIPBOARD_DATA_URL}
      download={fileName}
      className={`${HEADER_MENU_ITEM_CLASS} justify-between`}
    >
      <span className="flex items-center gap-2 whitespace-nowrap">
        <ClipboardDownIcon />
        サーバから保存
      </span>
      <span className="shrink-0 text-xs font-normal text-gray-500">{summary}</span>
    </a>
  ) : (
    <a href={SERVER_CLIPBOARD_DATA_URL} download={fileName} className={SMALL_CLASS}>
      保存
    </a>
  );

  return (
    <>
      {control}
      {error && (
        <span role="alert" className="block px-3 pb-1 text-sm font-normal text-red-700">
          {error}
        </span>
      )}
    </>
  );
}
