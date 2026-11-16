"use client";

import { useEffect, type RefObject } from "react";
import { splitTitleLinks } from "../event/titleLinks";

// 題名の中の URL の目印。値は開く URL
const LINK_ATTR = "data-event-link";

// 予定の題名。中の http(s) の URL を青字・下線で見せる (docs/126 §1-37)。
// 行そのものが <button> / <a> なので、中に <a> は置けない。押したときの動きは
// useTitleLinkClicks が受ける
export function TitleText({ title }: { title: string }) {
  return splitTitleLinks(title).map((part, index) =>
    part.kind === "text" ? (
      part.text
    ) : (
      <span
        key={index}
        data-event-link={part.text}
        title={`${part.text} をブラウザで開く`}
        className="cursor-pointer text-blue-700 underline"
      >
        {part.text}
      </span>
    ),
  );
}

// 一覧 (root) の中の URL を押したら、行の動き (題名の編集・フォーム・ノートを開く) の
// 代わりにブラウザで開く。
//
// **window の capture で受ける。** 1 ペインの一覧の行はノートへのリンクで、
// ClientNotePane が document の capture で押下を先に取ってノートへ移ってしまう。
// window の capture はそれより前に回るので、ここで止めればノートへは移らない
export function useTitleLinkClicks(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !root.current?.contains(target)) {
        return;
      }
      const url = target.closest(`[${LINK_ATTR}]`)?.getAttribute(LINK_ATTR);
      if (url === undefined || url === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      window.open(url, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [root]);
}
