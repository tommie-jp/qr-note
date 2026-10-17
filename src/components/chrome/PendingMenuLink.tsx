"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

// 遷移待ちの間だけ項目の右に出す「処理中です…」。useLinkStatus は Link の
// 子孫でしか pending を拾えないので、表示 (MenuLinkPendingNotice) と分けている
// (PendingLink.tsx と同じ形)。pending を引数で受ける表示部品は単体テスト用
export function MenuLinkPendingNotice({ pending }: { pending: boolean }) {
  if (!pending) {
    return null;
  }
  return (
    <span
      role="status"
      className="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-normal text-gray-500"
    >
      {/* 灰色の輪: ui.ts のスピナーは白系で、白いシートの上では見えない */}
      <span
        aria-hidden
        className="size-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"
      />
      処理中です…
    </span>
  );
}

function LinkPendingNotice() {
  const { pending } = useLinkStatus();
  return <MenuLinkPendingNotice pending={pending} />;
}

// メニュー (HeaderMenu のシート) の中で、遷移待ちを見せるリンク。
//
// 素の Link だと押した瞬間にシートが閉じ、サーバが応答するまで画面が何も
// 変わらない。loading.tsx を置いたページでも、proxy のセッション照会と根
// layout の DB 読み (currentUser・行の色) を待ってからでないと loading は
// 届かないので、DB が重いときほど「押しても何も起きない」になる
// (docs/109 §2 の注)。そこで押した側で待ちを出す:
//
// - クリックの伝播を止め、シートを開いたまま「処理中です…」を出す
//   (HeaderQrButton と同じ例外扱い。HeaderMenu の注を参照)
// - 遷移が終われば pathname が変わり、HeaderMenu が自分で閉じる
// - 今いるページと同じ href なら pathname が変わらず閉じる契機が無いので、
//   伝播を止めずにいつも通り閉じる
export function PendingMenuLink({
  children,
  href,
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (typeof href === "string" && href !== pathname) {
      event.stopPropagation();
    }
  };
  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
      <LinkPendingNotice />
    </Link>
  );
}
