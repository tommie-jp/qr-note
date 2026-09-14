import type { HTMLAttributes, ReactNode } from "react";
import { BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "@/components/ui";

// 赤いバナーの知らせ (BUSY_NOTICE_CLASS)。時間のかかる処理の進み具合
// (OCR・書誌取得・モデル準備・読み込み中) と、その場で気づいてほしい知らせ
// (録音の自動停止・お絵かきの失敗) に使う。もとは置き場ごとに
// 「<p> + スピナー + 文言」を手書きしていた (docs/93-リファクタリング計画.md §3-2)。
//
// **フックを持たない**ので "use client" は要らない。検索画面の Suspense の
// fallback (Server Component) からも、クライアント部品からも同じ物を使う。
//
// 読み上げへの伝え方 (aria-live / role / aria-busy) は置き場ごとに違うので、
// ここでは決めずに呼ぶ側が渡す:
//   - 後から現れる・中身が変わる知らせ … aria-live="polite"
//     (進み具合を持つ置き場は aria-busy も)
//   - それ自体が「読み込み中」の置き場 (Suspense の fallback など) … role="status"
type BusyNoticeProps = Pick<
  HTMLAttributes<HTMLParagraphElement>,
  "role" | "aria-live" | "aria-busy"
> & {
  children: ReactNode;
  // スピナーの席を持つ知らせか。与えると文字の前にスピナーを置く横並び
  // (flex) になり、true の間だけスピナーを出す。与えなければ文字だけの知らせ
  busy?: boolean;
  // 置き場ごとの配置 (absolute・余白)。BUSY_NOTICE_CLASS の後ろに足す
  // (ui.ts の注のとおり、置き場所のレイアウトは使う側で足す)
  className?: string;
};

export function BusyNotice({
  role,
  "aria-live": ariaLive,
  "aria-busy": ariaBusy,
  children,
  busy,
  className,
}: BusyNoticeProps) {
  const classes = [
    BUSY_NOTICE_CLASS,
    busy === undefined ? null : "flex items-center gap-2",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <p role={role} aria-live={ariaLive} aria-busy={ariaBusy} className={classes}>
      {busy && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
      {children}
    </p>
  );
}
