"use client";

import { useFormStatus } from "react-dom";
import {
  nextPaneMode,
  paneModeLabel,
  parsePaneMode,
  PANE_MODE_COOKIE,
  type PaneMode,
} from "@/lib/paneMode";

// ペイン構成のアイコン (docs/86 §4-4)。**いまの構成そのものを描く** —
// 押した先ではなく現状を見せる (下部バーの表示モードと同じ流儀)。
//
// 色は 3 つのペインで塗り分ける: フォルダー=青 / 検索結果=緑 / ノート=琥珀。
// 数字と合わせて、形と色と数の 3 通りで同じことを言う
function PaneModeIcon({ mode }: { mode: PaneMode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      {/* 外枠 (画面) */}
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" className="text-gray-400" />
      {mode === "3" && (
        <>
          {/* 左: フォルダー */}
          <rect x="2.5" y="4.5" width="6" height="15" rx="2" className="fill-blue-500/70 stroke-blue-600" />
          {/* 右上: 検索結果 */}
          <rect x="8.5" y="4.5" width="13" height="8" className="fill-emerald-500/70 stroke-emerald-600" />
          {/* 右下: ノート */}
          <rect x="8.5" y="12.5" width="13" height="7" className="fill-amber-400/70 stroke-amber-500" />
        </>
      )}
      {mode === "2" && (
        <>
          <rect x="2.5" y="4.5" width="19" height="8" rx="2" className="fill-emerald-500/70 stroke-emerald-600" />
          <rect x="2.5" y="12.5" width="19" height="7" rx="2" className="fill-amber-400/70 stroke-amber-500" />
        </>
      )}
      {mode === "1" && (
        <rect x="2.5" y="4.5" width="19" height="15" rx="2" className="fill-emerald-500/70 stroke-emerald-600" />
      )}
    </svg>
  );
}

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

// ペインはもともと広い画面にしか出ない (フォルダーは xl 以上、ノートの
// ペインは lg 以上) ので、スマホではボタンごと出さない — 押しても何も
// 変わらない物を、いちばん狭い画面の帯に置かない
export function PaneModeButton({
  mode,
  action,
}: {
  mode: PaneMode;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="hidden lg:block">
      <PaneModeSubmit current={mode} />
    </form>
  );
}
