"use client";

import { createContext, useActionState, type ReactNode } from "react";
import type { SaveState } from "@/lib/saveState";

// 保存の結果 (競合したときだけ非 null) をフォームの中へ配る。
// MemoEditor がバナーを、EditItemFields が url / mode の違いを読む
export const SaveFormContext = createContext<SaveState>(null);

interface NoteSaveFormProps {
  // Server Action。useActionState の作法で (前回の結果, FormData) を受ける
  action: (prev: SaveState, formData: FormData) => Promise<SaveState>;
  itemNo: string;
  className?: string;
  children: ReactNode;
}

// ノート保存フォームの包み (docs/87-編集競合対策計画.md §3-1)。
//
// **戻り値を受け取るためだけの Client Component**で、中身 (children) は
// 今までどおりサーバで描いた要素をそのまま入れる。
//
// 競合したとき action は redirect も revalidatePath も呼ばずに値を返すので、
// このルートは描き直されない = **エディタの本文は無傷のまま**バナーが出る。
// リダイレクトして下書きから復元する形にしないのはこのため (localStorage が
// 使えない環境や、debounce の取りこぼしに本文を預けずに済む)。
//
// 「更新」ボタンは MemoEditorInner が下部バーへ portal するが、DOM の
// 親子は保たれるので useFormStatus (EditToolbar) は今までどおり効く。
export function NoteSaveForm({
  action,
  itemNo,
  className,
  children,
}: NoteSaveFormProps) {
  const [state, formAction] = useActionState(action, null);

  return (
    <SaveFormContext.Provider value={state}>
      <form action={formAction} className={className}>
        <input type="hidden" name="itemNo" value={itemNo} />
        {children}
      </form>
    </SaveFormContext.Provider>
  );
}
