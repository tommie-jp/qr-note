"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { SlotIcon } from "@/components/bottombar/SlotIcon";
import type { useLongPress } from "@/components/item/row-actions/useLongPress";

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
  // ボタンの見た目。下部バーの等幅スロットか、見出し行のコンパクトな形か
  slotClass: string;
  // ラベルの器のクラス。見出し行 (inline) では狭いペインで文字を削る
  // (SLOT_LABEL_CLASS)。下部バーは等幅で溢れようがないので空
  labelClass?: string;
  expanded: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  press: ReturnType<typeof useLongPress>;
  onClick: (event: React.MouseEvent) => void;
}

// いま見せる値。送信中なら送った先、そうでなければサーバの値 (下の CycleSlot の注)。
//
// 同じ form の中の釦はどれもこれを読む — 並び順の種別と向き (SortSlot) は
// 別の釦だが 1 つの値 (8 値の Sort) を分け合うので、片方を押した往復の間も
// もう片方が送った先を先に見せる。form の外では pending が立たないので current のまま
export function useShownValue<T extends string>(
  cookieName: string,
  current: T,
  // 妥当な値をすべて並べた表。知らない値は current に倒す
  known: Record<T, unknown>,
) {
  const { pending, data } = useFormStatus();
  // FormData は送信ボタンの name/value から組まれるので普段は必ず表の中に居るが、
  // 別の cookie の釦が同じ form に居ても取り違えないよう名前と表の両方で見る
  const submitted = pending ? data?.get(cookieName) : null;
  const shown =
    typeof submitted === "string" && submitted in known
      ? (submitted as T)
      : current;
  return { pending, shown };
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
  slotClass,
  labelClass,
  expanded,
  buttonRef,
  press,
  onClick,
}: CycleSlotProps<T>) {
  const { pending, shown } = useShownValue(cookieName, current, labelOf);

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
      className={`${slotClass} text-gray-700`}
    >
      <SlotIcon color={color} busy={pending}>
        {iconOf[shown]}
      </SlotIcon>
      {/* ラベルは必ず span で包む。**裸のテキストのままでは削れない** —
          max-width を当てる相手が要る (SLOT_LABEL_CLASS) */}
      <span className={labelClass}>{labelOf[shown]}</span>
    </button>
  );
}
