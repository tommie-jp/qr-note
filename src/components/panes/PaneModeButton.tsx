"use client";

import { useFormStatus } from "react-dom";
import { PaneModeIcon } from "@/components/icons";
import {
  nextPaneMode,
  paneModeLabel,
  parsePaneMode,
  PANE_MODE_COOKIE,
  type PaneMode,
} from "@/lib/prefs/paneMode";

// ヘッダーのペイン構成ボタン (docs/86 §4-4)。押すと 3 → 2 → 1 → 3 と循環する。
//
// **送信中は送った先の構成を先に見せる** — 値の正本は cookie で、書き換えは
// サーバアクションの往復を待つ。current だけを見せると、押してから画面が
// 組み直されるまでアイコンも数字も動かない (下部バーの CycleSlot と同じ判断)。
// useFormStatus を使うのは、この形なら form の action を素のサーバアクションの
// まま置けて、JS 無効でも切り替わるから。
function PaneModeSubmit({ current }: { current: PaneMode }) {
  const { pending, data } = useFormStatus();
  const sent = pending ? parsePaneMode(data?.get(PANE_MODE_COOKIE)) : null;
  const shown = sent ?? current;
  const next = nextPaneMode(shown);

  return (
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
  );
}

// **どの幅でも出す** (docs/86 §4-9)。3 ペインは幅に関係なく 3 ペインなので、
// 狭い画面でボタンを隠すと、選んだ構成から抜ける手段が無くなる
export function PaneModeButton({
  mode,
  action,
}: {
  mode: PaneMode;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action}>
      <PaneModeSubmit current={mode} />
    </form>
  );
}
