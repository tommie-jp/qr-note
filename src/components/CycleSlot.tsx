"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { SlotIcon } from "@/components/SlotIcon";
import { BOTTOM_BAR_SLOT_CLASS } from "@/components/ui";
import type { useLongPress } from "@/components/useLongPress";

interface CycleSlotProps<T extends string> {
  // cookie 名。submit ボタンの name であり、送信中の FormData から
  // 「どの値を送ったか」を引く鍵でもある
  cookieName: string;
  // サーバが持っている今の値。送信していない間はこれを見せる
  current: T;
  // 循環の次を引く表。押した先の値 (submit の value) を決める
  nextOf: Record<T, T>;
  labelOf: Record<T, string>;
  iconOf: Record<T, ReactNode>;
  color: string;
  // 読み上げ用の説明。表示する値が決まってから組み立てる (下の shown 参照)
  describe: (value: T) => string;
  expanded: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  press: ReturnType<typeof useLongPress>;
  onClick: (event: React.MouseEvent) => void;
}

// 下部バーの「押すと値が循環する」スロット (表示モード / 並び順)。
//
// **送信中は送った先の値を先に見せる** (docs/62 §3-1)。値の正本は cookie で、
// 書き換えはサーバアクションの往復を待つ。素直に current だけを見せると、
// 押してから一覧が組み直されるまでスロットは古い値のまま動かない。
// タップの循環はボタンが指の下で押下反転するのでその間も手応えがあるが、
// 長押しメニューの行を選ぶ経路は**選んだ瞬間にメニューが消えるだけ**で、
// 往復のあいだ画面に何の変化も残らない — これが「長押しで選ぶと遅い」の
// 正体で、実測でも往復そのものはタップと同じ (どちらも POST 1 回) だった。
//
// useFormStatus を使うのは、**この形なら JS 無効でも動くから**。
// form の action は素のサーバアクションのまま (クライアント関数で包むと
// ネイティブの送信ができなくなり、JS 無効では切り替わらなくなる) で、
// 送信中の FormData を中から覗くだけにする。useOptimistic では action を
// 包む必要があり、そこが崩れる。
//
// この手が使えるのは form の**中**の部品だけなので、ボタンごと切り出してある。
export function CycleSlot<T extends string>({
  cookieName,
  current,
  nextOf,
  labelOf,
  iconOf,
  color,
  describe,
  expanded,
  buttonRef,
  press,
  onClick,
}: CycleSlotProps<T>) {
  const { pending, data } = useFormStatus();
  // 送った値が知らないものだったら current に倒す。FormData は
  // 送信ボタンの name/value から組まれるので普段は必ず表の中に居るが、
  // labelOf は妥当な値をすべて並べた表そのものなので、これで畳める
  const submitted = pending ? data?.get(cookieName) : null;
  const shown =
    typeof submitted === "string" && submitted in labelOf
      ? (submitted as T)
      : current;

  return (
    <button
      ref={buttonRef}
      type="submit"
      name={cookieName}
      // 循環の次は**表示している値**から引く。current から引くと、往復の
      // あいだに続けて押したとき同じ値をもう一度送ることになる
      value={nextOf[shown]}
      aria-label={describe(shown)}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-busy={pending}
      {...press.handlers}
      onClick={onClick}
      className={`${BOTTOM_BAR_SLOT_CLASS} text-gray-700`}
    >
      <SlotIcon color={color} busy={pending}>
        {iconOf[shown]}
      </SlotIcon>
      {labelOf[shown]}
    </button>
  );
}
