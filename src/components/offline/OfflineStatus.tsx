"use client";

import { COMPACT_SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { formatJstDateTime } from "@/lib/datetime";
import type { PinProgress } from "@/lib/offline/pinCache";
import type { PrefetchProgress } from "@/lib/offline/sync";

interface OfflineStatusProps {
  syncedAt: string | null;
  count: number;
  truncated: boolean;
  // 予算に入り切らず運べなかった回路図の数 (docs/65-オフライン対応計画.md §8)
  circuitsOmitted: number;
  // 「オフラインで使う」印の付いたノート数
  pinnedCount: number;
  isSyncing: boolean;
  // サムネ先読みの進み具合。null = まだ走っていない
  prefetch: PrefetchProgress | null;
  // 印付きノートの持ち出しの進み具合。null = まだ走っていない
  pinProgress: PinProgress | null;
  // 端末が使っている保存容量。null = 調べられない環境
  usage: { usage: number; quota: number } | null;
  // 直近の操作の結果 (成功・失敗どちらも出す)
  message: string | null;
  isError: boolean;
  onSync: () => void;
  onPrefetch: () => void;
  onPinSync: () => void;
}

// オフラインの持ち出し状況と、手で撃つ 3 つの操作 (docs/65-オフライン対応計画.md §3-3)。
//
// **「いつ時点のデータか」を必ず出す**のがこの帯の役目。オフラインの一覧は
// 黙っていると「今のノート」に見えるが、実際は最後に同期した時点の写しで、
// その差が事故になる (棚の前で古い在庫数を読む、など)。
//
// 操作を 3 つに分けているのは通信量の性質が違うため:
//   今すぐ同期   … 本文と回路図。数百 KB なので自動でも撃つ (OfflineSync)
//   画像も保存   … サムネ全件。数 MB〜十数 MB になりうるので**手動のみ**
//   印の分を保存 … 印付きノートの原寸・シークレット。印を付けたのが同意なので
//                  自動でも撃つが、圏外で落とし損ねた分をここから埋められる
export function OfflineStatus({
  syncedAt,
  count,
  truncated,
  circuitsOmitted,
  pinnedCount,
  isSyncing,
  prefetch,
  pinProgress,
  usage,
  message,
  isError,
  onSync,
  onPrefetch,
  onPinSync,
}: OfflineStatusProps) {
  const isPrefetching = prefetch !== null && prefetch.done < prefetch.total;
  const isPinning = pinProgress !== null && pinProgress.done < pinProgress.total;

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
        {/* 印が 1 つも無いなら出さない。押しても何も起きないボタンを並べると、
            「押したのに変わらない」を確かめる時間を取らせることになる */}
        {pinnedCount > 0 && (
          <button
            type="button"
            onClick={onPinSync}
            disabled={isPinning}
            className={COMPACT_SECONDARY_BUTTON_CLASS}
          >
            {isPinning
              ? `印の分 ${pinProgress.done}/${pinProgress.total}`
              : `印の分を保存 (${pinnedCount})`}
          </button>
        )}
      </div>

      {truncated && (
        <p className="text-amber-700">
          ノートが多いため一部だけを保存しています（更新の新しい順）。
        </p>
      )}

      {/* 回路図の打ち切り。**黙って落とすと「圏外でだけ図が出ない」**という、
          原因の掴めない差になる (docs/65 §8) */}
      {circuitsOmitted > 0 && (
        <p className="text-amber-700">
          回路図が多いため {circuitsOmitted} 枚は保存していません（印を付けたノートを優先しています）。
        </p>
      )}

      {usage !== null && (
        <p className="text-gray-400">
          この端末の保存量: {formatBytes(usage.usage)} / {formatBytes(usage.quota)}
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

// 端末の保存容量なので 1KB = 1024 で数える (OfflinePinToggle と同じ)。
// GB まで出すのは quota が数 GB になるため
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
