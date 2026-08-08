"use client";

import type { ReactNode } from "react";

// 下部バーのスロットに乗せるアイコン (docs/31-下部操作バー計画.md §11-1)。
//
// 色をアイコン側ではなく呼ぶ側から与えるのは、選択スロットが押下中に白へ
// 反転するため — 反転を知っているのはバーだけで、currentColor 経由なら
// text-white がそのまま勝つ。ラベルの文字は塗らない。0.625rem を 5 色に
// 塗るとうるさく、読みにくくなる。
export function SlotIcon({
  color,
  busy = false,
  children,
}: {
  color: string;
  // 送信がまだ終わっていない間の合図 (docs/62 §3-1)。ラベルは楽観的に
  // 切り替わってしまうので、「まだ一覧が組み直されていない」ことを
  // 伝えるものが他に無くなる。薄くするのはアイコンだけ — ラベルは
  // 読む情報なので、常にはっきり出す
  busy?: boolean;
  children: ReactNode;
}) {
  // flex … span を inline のまま置くと svg の下にベースラインぶんの隙間が出る。
  // transition-opacity … 往復が 50ms で終わる場面では薄まりきる前に戻るので、
  // 速いときほど何も起きなかったように見える (瞬間的な点滅にならない)
  return (
    <span
      className={`flex transition-opacity ${color} ${busy ? "opacity-50" : ""}`}
    >
      {children}
    </span>
  );
}
