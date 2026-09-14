"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  PRIMARY_BUTTON_CLASS,
  SUBMIT_ICON_SPINNER_CLASS,
  SUBMIT_SPINNER_CLASS,
} from "./ui";

interface SubmitButtonProps {
  children: ReactNode;
  pendingLabel?: string;
  // 主ボタン (PRIMARY_BUTTON_CLASS) の後ろに足すクラス
  className?: string;
  // 主ボタンの形を使わない置き場の見た目 (下部バーの更新 = EditToolbar の
  // SUBMIT_SLOT)。与えると PRIMARY_BUTTON_CLASS と className は使わず、これだけで
  // 描く。className に足す形にしないのは、主ボタンの地色や寸法を打ち消す手が
  // 無いため (Tailwind の同種ユーティリティは並び順では勝敗が決まらない)
  overrideClassName?: string;
  // 送信中でない間に文字の前へ出すアイコン。送信中はアイコンと同じ寸法の
  // スピナーに入れ替える。無ければスピナーは文字の前に小さく (16px) 添える
  icon?: ReactNode;
  // 与えると type="button" になり、押したときにこれを呼ぶ。portal で DOM が
  // form の外に出る置き場 (下部バー) では submit の DOM 関連付けが効かないので、
  // 呼ぶ側が form.requestSubmit() を明示的に呼ぶ (editor/hooks/useSubmitBlocker.ts の submitForm を渡す)。
  // 無ければ素の type="submit"
  onClick?: () => void;
}

// 送信中を表示する送信ボタン (docs/11-アプリ的UIUX計画.md §1-1)。
// 全ページ force-dynamic でサーバ応答を待つため、押しても無反応に見えていた。
//
// useFormStatus は form の子孫コンポーネントでしか pending を拾えないので、
// ページ (Server Component) からこのボタンだけを client component に切り出す。
// disabled が二重送信も止める。
//
// editor/hooks/useSubmitBlocker.ts の「アップロード中は submit を preventDefault」とは独立に動く。
// React の form action は defaultPrevented なら action を実行しないため、
// ブロックされた送信でここが pending のまま固まることはない。
//
// もとは下部バーの更新ボタン (EditToolbar の SubmitBarButton) が同じ仕組みを
// 別に持っていた。違いは type / 見た目 / アイコンだけなので、ここに寄せた
// (docs/93-リファクタリング計画.md §3-2)
export function SubmitButton({
  children,
  pendingLabel = "更新中です…",
  className = "",
  overrideClassName,
  icon,
  onClick,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const spinnerClass = icon ? SUBMIT_ICON_SPINNER_CLASS : SUBMIT_SPINNER_CLASS;

  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={pending}
      aria-busy={pending}
      className={overrideClassName ?? `${PRIMARY_BUTTON_CLASS} ${className}`}
    >
      {pending ? <span aria-hidden className={spinnerClass} /> : icon}
      {pending ? pendingLabel : children}
    </button>
  );
}
