"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { formatJstDateTime } from "@/lib/datetime";
import type { SaveState } from "@/lib/saveState";
import { SECONDARY_BUTTON_CLASS } from "./ui";

// 差分は @codemirror/merge を引く。押されるまで読み込まない
// (競合は稀で、編集画面の初期表示に載せる理由がない)
const NoteDiffView = dynamic(
  () => import("./NoteDiffView").then((m) => m.NoteDiffView),
  { ssr: false, loading: () => null },
);

interface SaveConflictBannerProps {
  // null でないときだけ描く (呼び手が既読の seq を落としてから渡す)
  state: NonNullable<SaveState>;
  // いま編集中の本文。差分の「自分の版」側
  value: string;
  onAdoptServer: () => void;
  onOverwrite: () => void;
  onSaveAsNew: () => void;
  onDismiss: () => void;
}

// 競合を知らせて選ばせる (docs/87-編集競合対策計画.md §3-3)。
//
// **保存を拒否して終わりにしない**のが役目。捨てさせないための 3 択
// (差分を見る / サーバ版を読み込む / このまま上書き) を必ず並べる。
//
// 文言で「別の端末」と決めつけない — 同じ画面の markdown タブでチェックを
// 押しただけでもここに来る。
export function SaveConflictBanner({
  state,
  value,
  onAdoptServer,
  onOverwrite,
  onSaveAsNew,
  onDismiss,
}: SaveConflictBannerProps) {
  const [showDiff, setShowDiff] = useState(false);
  const server = state.server;

  return (
    <div
      aria-live="polite"
      className="space-y-2 rounded bg-amber-50 px-3 py-2 text-amber-900"
    >
      <p>{message(state)}</p>

      {/* url / mode は notes/<itemNo>.md に入らない = 履歴から戻せない。
          上書きする前に見せておく (docs/87 §3-3) */}
      {server && server.url !== "" && (
        <p className="break-all text-sm">
          別の版の URL: <span className="font-mono">{server.url}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {server && (
          <button
            type="button"
            onClick={() => setShowDiff((shown) => !shown)}
            className={SECONDARY_BUTTON_CLASS}
          >
            {showDiff ? "差分を隠す" : "差分を見る"}
          </button>
        )}
        {server && state.kind !== "checkpointFailed" && (
          <button type="button" onClick={onAdoptServer} className={SECONDARY_BUTTON_CLASS}>
            別の版を読み込む
          </button>
        )}
        {server && (
          <button type="button" onClick={onOverwrite} className={SECONDARY_BUTTON_CLASS}>
            {state.kind === "checkpointFailed" ? "もう一度試す" : "このまま上書き"}
          </button>
        )}
        {state.kind === "missing" && (
          <button type="button" onClick={onSaveAsNew} className={SECONDARY_BUTTON_CLASS}>
            新規として保存
          </button>
        )}
        <button type="button" onClick={onDismiss} className={SECONDARY_BUTTON_CLASS}>
          閉じる
        </button>
      </div>

      {showDiff && server && (
        // 左が別の版、右がいま編集中の本文
        <NoteDiffView oldText={server.memo} newText={value} />
      )}
    </div>
  );
}

function message(state: NonNullable<SaveState>): string {
  const at =
    state.server === null
      ? ""
      : formatJstDateTime(new Date(state.server.updatedAt));
  const trashed =
    state.server?.deletedAt != null
      ? " (このノートはゴミ箱にあります)"
      : "";

  switch (state.kind) {
    case "conflict":
      return `別の端末 (またはこの画面の別の操作) で本文が ${at} に更新されています。あなたの変更はまだ保存されていません。${trashed}`;
    case "exists":
      return `このノートは別の操作で先に作成されています (${at})。あなたの変更はまだ保存されていません。${trashed}`;
    case "missing":
      return "このノートは削除されました。あなたの変更はまだ保存されていません。";
    case "checkpointFailed":
      return "上書きで消える版を履歴に残せなかったので、保存していません。差分を控えてから、もう一度お試しください。";
  }
}
