"use client";

import { COMPACT_SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { formatJstDateTime } from "@/lib/datetime";
import type { PrefetchProgress } from "@/lib/offline/sync";

interface OfflineStatusProps {
  syncedAt: string | null;
  count: number;
  truncated: boolean;
  isSyncing: boolean;
  // サムネ先読みの進み具合。null = まだ走っていない
  prefetch: PrefetchProgress | null;
  // 直近の操作の結果 (成功・失敗どちらも出す)
  message: string | null;
  isError: boolean;
  onSync: () => void;
  onPrefetch: () => void;
}

// オフラインの持ち出し状況と、手で撃つ 2 つの操作 (docs/65-オフライン対応計画.md §3-3)。
//
// **「いつ時点のデータか」を必ず出す**のがこの帯の役目。オフラインの一覧は
// 黙っていると「今のノート」に見えるが、実際は最後に同期した時点の写しで、
// その差が事故になる (棚の前で古い在庫数を読む、など)。
//
// 操作を 2 つに分けているのは通信量の性質が違うため:
//   今すぐ同期 … 本文だけ。数百 KB なので自動でも撃つ (OfflineSync)
//   画像も保存 … サムネ全件。数 MB〜十数 MB になりうるので**手動のみ**
export function OfflineStatus({
  syncedAt,
  count,
  truncated,
  isSyncing,
  prefetch,
  message,
  isError,
  onSync,
  onPrefetch,
}: OfflineStatusProps) {
  const isPrefetching = prefetch !== null && prefetch.done < prefetch.total;

  return (
    <div className="space-y-2 rounded border border-gray-200 bg-white px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex-1 text-gray-600">
          {syncedAt === null ? (
            // 同期前でもこの画面は開ける (/offline は公開パス)。何も無いことを
            // 「0 件」ではなく「まだ保存していない」と言う — 直し方が違う
            <span>オフライン用のノートはまだ保存されていません</span>
          ) : (
            <span>
              {count} 件を保存済み
              <span className="text-gray-400">（{formatJstDateTime(new Date(syncedAt))} 時点）</span>
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={onSync}
          disabled={isSyncing}
          className={COMPACT_SECONDARY_BUTTON_CLASS}
        >
          {isSyncing ? "同期中…" : "今すぐ同期"}
        </button>
        <button
          type="button"
          onClick={onPrefetch}
          disabled={isPrefetching || count === 0}
          className={COMPACT_SECONDARY_BUTTON_CLASS}
        >
          {isPrefetching ? `画像 ${prefetch.done}/${prefetch.total}` : "画像も保存"}
        </button>
      </div>

      {truncated && (
        <p className="text-amber-700">
          ノートが多いため一部だけを保存しています（更新の新しい順）。
        </p>
      )}

      {message !== null && (
        <p role="status" className={isError ? "text-red-700" : "text-gray-600"}>
          {message}
        </p>
      )}
    </div>
  );
}
