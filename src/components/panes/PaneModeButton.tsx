"use client";

import { useRouter } from "next/navigation";
import { startTransition, type FormEvent } from "react";
import { PaneModeIcon } from "@/components/icons";
import { switchPaneMode } from "@/components/panes/switchPaneMode";
import {
  nextPaneMode,
  paneModeLabel,
  PANE_MODE_COOKIE,
  type PaneMode,
} from "@/lib/prefs/paneMode";
import { useShownPaneMode } from "@/lib/prefs/pendingPaneMode";

// ヘッダーのペイン構成ボタン (docs/86 §4-4)。押すと 3 → 2 → 1 → 3 と循環する。
//
// **押した瞬間に送った先の構成で画面を組み替える** (docs/86 §4-18)。値の正本は
// cookie だが、器の積み方は CSS と PreviewPane が決めるのでサーバを待つ必要が
// ない。送った先は pendingPaneMode に置き、検索画面 (PaneModeProvider) も同じ
// 値を読む。cookie の保存と描き直しは switchPaneMode が後ろで進める。
//
// form の action (サーバアクション) は **JS が無いときの受け皿** として残す。
// JS があれば onSubmit で送信を止めるので、アクションは呼ばれない
// (React は defaultPrevented の submit で action を走らせない)
export function PaneModeButton({
  mode,
  action,
}: {
  mode: PaneMode;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();
  const shown = useShownPaneMode(mode);
  const next = nextPaneMode(shown);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void switchPaneMode(next, () => {
      startTransition(() => router.refresh());
    });
  };

  return (
    // **どの幅でも出す** (docs/86 §4-9)。3 / 2 ペインは幅に関係なくペインなので、
    // 狭い画面でボタンを隠すと、選んだ構成から抜ける手段が無くなる
    <form action={action} onSubmit={onSubmit}>
      <button
        type="submit"
        name={PANE_MODE_COOKIE}
        value={next}
        // 押した先ではなく今の構成を読み上げる。押すと何になるかは title に添える
        aria-label={paneModeLabel(shown)}
        title={`${paneModeLabel(shown)} — 押すと ${paneModeLabel(next)}`}
        className="inline-flex min-h-11 items-center gap-1 rounded px-1.5 lg:min-h-0 text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
      >
        <PaneModeIcon mode={shown} />
        <span className="font-mono text-sm">{shown}</span>
      </button>
    </form>
  );
}
