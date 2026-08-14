"use client";

import { useState } from "react";
import { TrashIcon } from "@/components/MenuIcons";
import { COMPACT_ICON_BUTTON_CLASS } from "@/components/ui";

// ログの控えを消すボタン (docs/30-ブラウザログ計画.md §7)。
// 実機調査では「一度消してから再現操作をする」と、/logs に並ぶのが今回の
// 再現ぶんだけになり、どこからが新しいログか数えなくて済む。
//
// useRouter は使わない: /logs の一覧はサーバ側で描くので再読み込みで足り、
// hook を持ち込むとページの静的描画テスト (page.test.tsx) が router の
// マウントを要求して壊れる
export function ClearLogsButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/logs/clear", { method: "POST" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // サーバ側の控えが消えたので、一覧を読み直して空にする
      location.reload();
    } catch (e) {
      setError(
        `ログを消去できませんでした (${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={clear}
        disabled={busy}
        // 文字を置かないので意味は名前で名乗る。消去中は文字 (「消去中…」) の
        // 代わりに aria-busy と disabled で伝える — ラベルの文字数でボタンの幅が
        // 動くと、隣のコピーの位置までずれる
        aria-label="ログをクリア"
        aria-busy={busy}
        title="ログをクリア"
        className={COMPACT_ICON_BUTTON_CLASS}
      >
        {/* 色は中の span で与える。TrashIcon は色を持たず currentColor で
            描くうえ、ボタン側のクラス (COMPACT_ICON_BUTTON_CLASS) が
            text-gray-700 を含むため (RowActions.tsx と同じ事情)。
            red-700 は使わない — ノートを消す DANGER_BUTTON_CLASS と同格に
            見せると、控えを捨てるだけの操作を取り違える (LogoutIcon と同じ判断) */}
        <span className="text-rose-600">
          <TrashIcon />
        </span>
      </button>
    </span>
  );
}
