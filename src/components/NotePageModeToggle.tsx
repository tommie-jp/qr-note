"use client";

import { ContinuousIcon, PagedIcon } from "@/components/MenuIcons";
import { PressTip } from "@/components/PressTip";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { setNotePagerPaged, useNotePagerPaged } from "@/lib/notePagerPref";

// ページ送り / 通し表示の切り替え (docs/82-ノート操作アイコン計画.md §3)。
//
// 置き場所は見出し行の QR の右。ページは**本文の読み方**の話なので、状態の
// トグル (公開・オフライン印) ではなく操作リンクの側に並べる。
//
// **出すのはいまの状態**で、押した後の動作名ではない (PublicToggle と同じ約束)。
// 紙 + 送りの山形 = いまページ送り、上下へ続く帯 = いま通し。
//
// **文字は持たない。** 公開・オフラインと同じ「状態を出すトグル」なので
// そちらに揃える (docs/82 §6) — 文字を足すと、区切りのあるノートだけ操作の行が
// 1 行増えて本文が下がる (幅 414px で実測)。ページを畳んで本文を早く出す
// ための機能が、本文を押し下げるのでは元も子もない。
// 名前と説明は aria-label と長押しの吹き出しが言う。
//
// aria-pressed は付けない — aria-label が状態そのものなので、「押されている」が
// 二重に読み上げられるだけになる (PublicToggle と同じ判断)。
//
// 区切りの無いノートでは**呼ぶ側が出さない** (ItemView)。1 ページのノートで
// 押しても見た目は何も変わらず、押せるのに何も起きないボタンになる。
//
// 本文 (NotePager) との間に props も context も通っていない。設定の正本は
// localStorage (React の外) で、押した側が書き、読む側が購読する
// (lib/notePagerPref.ts)。
export function NotePageModeToggle() {
  const paged = useNotePagerPaged();

  return (
    <PressTip
      label={
        paged
          ? "ページ送り中 — 押すと全ページを続けて出す"
          : "通し表示中 — 押すとページ送りに戻す"
      }
    >
      <button
        type="button"
        aria-label={paged ? "ページ送り" : "通し表示"}
        onClick={() => setNotePagerPaged(!paged)}
        className={ACTION_LINK_CLASS}
      >
        {paged ? <PagedIcon /> : <ContinuousIcon />}
      </button>
    </PressTip>
  );
}
