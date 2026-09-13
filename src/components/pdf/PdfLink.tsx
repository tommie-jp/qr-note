"use client";

import { useState } from "react";
import { PdfViewerModal } from "./PdfViewerModal";

interface PdfLinkProps {
  href: string;
  // 挿入時のファイル名 (lib/editor/attachmentKinds.ts の attachmentAltText)。表示名に使う
  label: string;
}

// 本文に貼られた PDF への入口。
//
// **押すとページ内のモーダルで開く** (画面遷移しない)。ホーム画面から起動した
// iOS PWA (standalone) では target="_blank" が効かず、同じ webview がそのまま
// PDF へ遷移してしまい、戻るボタンが無いためアプリを強制終了するまでノートへ
// 戻れなくなる (実機で確認。pdfService.ts の冒頭に経緯)。
//
// **なぜ <a> ではなく <button> か**: <a href> のままだと、ハイドレーション前に
// 押されたときブラウザ既定の遷移が起きてしまい、まさに直そうとしている
// 「PDF を開いたら戻れない」に落ちる。実際 E2E で、読み込み直後に押すと
// 新しいタブが開いた。<button> なら JS が付くまで**何も起きない**ので、
// 遷移で詰まることが構造上ない (待たせるほうが、閉じ込めるよりよい)。
//
// 別タブで開きたいとき (PC ではネイティブビューアの方が快適) の逃げ道は、
// モーダルのヘッダに「新しいタブ」として置いてある。
export function PdfLink({ href, label }: PdfLinkProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        // prose の中に置くのでリンクらしい見た目に寄せる
        className="cursor-pointer break-all text-left text-blue-700 underline"
      >
        📄 {label}
      </button>
      {isOpen && (
        <PdfViewerModal
          url={href}
          label={label}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
