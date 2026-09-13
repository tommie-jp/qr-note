"use client";

import { useCallback, useState } from "react";
import { QrIcon } from "@/components/MenuIcons";
import { ModalOverlay } from "@/components/modal/ModalOverlay";
import { useEscapeKey } from "@/components/modal/useEscapeKey";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";

interface HeaderQrButtonProps {
  qrDataUrl: string;
  url: string;
  // ヘッダーに直接置くか、ハンバーガーメニューの 1 行として置くか
  variant?: "header" | "menu";
}

// ヘッダー右端の「QR」。クリックで公開サイト URL を埋め込んだ QR を
// オーバーレイ表示し、もう一度のクリックか Esc で閉じる。
export function HeaderQrButton({
  qrDataUrl,
  url,
  variant = "header",
}: HeaderQrButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => setIsOpen(false), []);
  useEscapeKey(close, isOpen);

  return (
    <>
      <button
        type="button"
        className={
          variant === "menu"
            ? HEADER_MENU_ITEM_CLASS
            : "text-gray-500 hover:text-gray-900"
        }
        onClick={(event) => {
          // メニューの中に居るとき、親のバブリングで閉じられないようにする。
          // 閉じるとこの部品ごと unmount され、開いたはずの QR
          // (portal で出しているオーバーレイ) も道連れに消える
          event.stopPropagation();
          setIsOpen(true);
        }}
      >
        {variant === "menu" ? (
          <>
            <QrIcon />
            QR コード
          </>
        ) : (
          "QR"
        )}
      </button>
      {isOpen && (
        <ModalOverlay variant="zoom" onClose={close}>
          {/* max-h + overflow … QR (240px) + URL で高さ 300px を超えるため、
              スマホ横持ち (視界 300px 台) でははみ出す。器の p-4 の内側に
              収めて中をスクロールさせる (docs/31 §12) */}
          <div className="max-h-full overflow-y-auto border border-gray-300 bg-white p-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={`QR: ${url}`} width={240} height={240} />
            <div className="mt-1 break-all font-mono text-gray-600">{url}</div>
          </div>
        </ModalOverlay>
      )}
    </>
  );
}
