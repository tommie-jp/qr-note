"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/components/modal/useBodyScrollLock";
import { useEscapeKey } from "@/components/modal/useEscapeKey";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { errorText } from "@/lib/errorMessage";
import { guiFenceLangsIn } from "@/lib/editor/fenceAtCursor";
import { loadFenceEditors } from "@/lib/fenceGui/editors";
import {
  FENCE_MAP_SCRIPT,
  type FenceGuiHandle,
  openFenceGui,
} from "./openFenceGui";

interface FenceGuiModalProps {
  // 開いたときの本文 (全文) と、掴むフェンスの本文 1 行目 (0 始まり)
  text: string;
  fenceLine: number;
  // 閉じたとき。殻が書き換えたあとの本文を渡す (変わっていなければ text のまま)。
  // 破棄したときは開いたときの text をそのまま渡す
  onClose: (next: string) => void;
}

// 破棄の前の確認。殻の履歴は iframe と一緒に消えるので、捨てたら戻せない
const DISCARD_CONFIRM = "図の変更は本文に反映されません。破棄しますか？";

// 図を掴んで動かす殻の器 (docs/99-フェンスGUI編集計画.md §2 の決め 7)。
// 画面全体を覆い、上の白い帯に題と「破棄」「閉じる」、残りを殻の iframe にする。
//
// - **閉じる = 本文に当てる。** 閉じたあとはエディタの元に戻す 1 回で開く前へ戻る。
//   Esc も閉じる側 (押し間違えても戻せる側) に倒す
// - **破棄 = 本文に当てずに戻る** (docs/99 §2 の決め 6 の追記)。変えていれば確認を
//   挟む。殻の中の履歴は閉じると消えるので、捨てたら取り戻せない
// - **角とホームバーは器で避ける。** iframe の中の env() はブラウザで値が
//   違う (上流 52 の docs/50)
// - 器に touch-none は付けない。2 本指の移動とピンチは殻が iframe の中で捌く
export function FenceGuiModal({ text, fenceLine, onClose }: FenceGuiModalProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const handleRef = useRef<FenceGuiHandle | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useBodyScrollLock();

  useEffect(() => {
    // 処理系は開くときに、ノートに書いてある言語の分だけ読む (docs/100 の決め 3)。
    // 読み終わる前に閉じられたら組まない
    let cancelled = false;
    loadFenceEditors(guiFenceLangsIn(text))
      .then((editors) => {
        const frame = frameRef.current;
        if (cancelled || frame === null) {
          return;
        }
        handleRef.current = openFenceGui({
          frame,
          host: window,
          editors,
          text,
          fenceLine,
          scriptUri: FENCE_MAP_SCRIPT,
        });
      })
      .catch((error: unknown) => {
        // 電波が切れて処理系を取れなかった、など。空の枠のまま黙らない
        console.error("図の編集を開けませんでした", error);
        if (!cancelled) {
          setFailure(errorText(error));
        }
      });
    return () => {
      cancelled = true;
      handleRef.current?.close();
      handleRef.current = null;
    };
  }, [text, fenceLine]);

  const close = useCallback(() => {
    onClose(handleRef.current?.text() ?? text);
  }, [onClose, text]);
  // 何も変えていなければ黙って閉じる (殻をまだ組めていないときも同じ)
  const discard = useCallback(() => {
    const edited = handleRef.current?.text() ?? text;
    if (edited !== text && !window.confirm(DISCARD_CONFIRM)) {
      return;
    }
    onClose(text);
  }, [onClose, text]);
  // 焦点が殻の中 (iframe) にあるときの Esc は殻のもの (持ち上げた部品を
  // 戻すなど)。ここに届くのは焦点が外の帯にあるときだけ
  useEscapeKey(close);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="図を編集"
      className="fixed inset-0 z-50 flex flex-col bg-white pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-gray-900"
    >
      <div className="flex items-center gap-3 border-b border-gray-200 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-sm">
        <h2 className="shrink-0 font-bold">図を編集</h2>
        <p className="min-w-0 flex-1 truncate text-gray-500">
          閉じると本文に反映します
        </p>
        <button
          type="button"
          onClick={discard}
          className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
        >
          破棄
        </button>
        <button
          type="button"
          onClick={close}
          className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
        >
          閉じる
        </button>
      </div>
      {failure !== null && (
        <p role="alert" className="p-3 text-sm text-red-700">
          図の編集を開けませんでした: {failure}
        </p>
      )}
      <iframe
        ref={frameRef}
        // 同じ出所を与えない (allow-same-origin を付けない)。中の頁はノート本文
        // から組むので、上流のエスケープに漏れがあってもアプリに手が届かない
        // ようにする。殻は localStorage も cookie も使わず、親へ postMessage
        // するだけなので、これで足りる (docs/99 §2 の決め 14)
        sandbox="allow-scripts"
        title="図を編集"
        className="min-h-0 w-full flex-1 border-0"
      />
    </div>,
    document.body,
  );
}
