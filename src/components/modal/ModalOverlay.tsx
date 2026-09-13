"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// 画面全体を覆う器 (docs/93-リファクタリング計画.md §3-2)。body へ portal し、
// fixed inset-0 で覆う。
//
// **枠の class が一字一句同じ部品だけをここへ寄せる。** 見た目は 2 通り:
//
// - viewer … 半透明の暗幕に、上端の白い帯 + 中身を縦に積む
//   (TextViewerModal・PdfViewerModal・SecretDialog)
// - zoom … 暗幕の中央に 1 枚を置き、**覆いのどこを押しても閉じる**
//   (ZoomableImage・HeaderQrButton)。閉じてほしくない操作は、その部品が
//   自分で stopPropagation する
//
// カメラ系 (ScannerModal・ImageSearchModal) は黒の濃さと文字色の置き場が
// 違い、録画・お絵かきは role="dialog" を持ち、HeaderMenu はボトムシートなので、
// それぞれ自前の枠のまま置いている。Escape と背面スクロールの固定は
// 部品ごとに条件が違うので、ここでは持たない (useEscapeKey・useBodyScrollLock)
type ModalOverlayProps =
  | { variant: "viewer"; children: ReactNode }
  | { variant: "zoom"; onClose: () => void; children: ReactNode };

export function ModalOverlay(props: ModalOverlayProps) {
  if (props.variant === "zoom") {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-4"
        onClick={() => props.onClose()}
      >
        {props.children}
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/90">
      {props.children}
    </div>,
    document.body,
  );
}
