"use client";

import { useState } from "react";
import { TextViewerModal } from "./TextViewerModal";

interface TextLinkProps {
  href: string;
  // 挿入時のファイル名 (MemoEditorInner の attachmentAltText)。表示名に使う
  label: string;
}

// 本文に貼られたテキスト添付 (txt/csv/md) への入口。
//
// **PDF (PdfLink.tsx) とまったく同じ形にしてある。** 押すとページ内のモーダルで
// 開き、画面遷移させない。理由も同じで、ホーム画面から起動した iOS PWA
// (standalone) では target="_blank" が効かず、同じ webview がそのまま
// テキストの生表示へ遷移して戻れなくなる (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// <a href> ではなく <button> なのも同じ理由 — <a> だとハイドレーション前に
// 押されたときブラウザ既定の遷移が起きてしまい、直したはずの「開いたら戻れない」
// が起動直後という**いちばん踏みやすい瞬間に**残る。
export function TextLink({ href, label }: TextLinkProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        // prose の中に置くのでリンクらしい見た目に寄せる
        className="cursor-pointer break-all text-left text-blue-700 underline"
      >
        📝 {label}
      </button>
      {isOpen && (
        <TextViewerModal
          url={href}
          label={label}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
