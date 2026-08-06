import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { backfillHistoryAction } from "@/app/actions";
import { PRIMARY_BUTTON_CLASS } from "@/components/ui";
import { isDemoMode } from "@/lib/appEnv";
import { requireUser } from "@/lib/session";

// サイト名は付けない。root layout の title.template が付ける
export const metadata: Metadata = {
  title: "履歴取り込み",
};

interface HistorySettingsPageProps {
  searchParams: Promise<{ done?: string }>;
}

// 既存ノートを git 履歴へ取り込む設定画面 (docs/57-ノートgit履歴計画.md §6)。
//
// 本番はビルド済みイメージ (standalone) に scripts/ が無いため、この画面が
// 本番での実行経路になる (ローカルは npm run backfill:git でもよい)。
//
// proxy.ts も未ログインの画面 GET を止めるが、それは楽観的な検査であって
// 唯一の砦にはしない (settings/import と同じ流儀)。
export default async function HistorySettingsPage({
  searchParams,
}: HistorySettingsPageProps) {
  // デモでは履歴機能ごと閉じている (docs/57 §4)。URL 直打ちに備えて 404 に倒す
  if (isDemoMode()) {
    notFound();
  }
  await requireUser();
  const { done } = await searchParams;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-bold">ノート履歴の取り込み</h1>
        <p className="text-gray-600">
          既存の全ノート (ゴミ箱含む) を、履歴の起点として 1 回のコミットで
          取り込みます。以後は各ノートの「履歴」からコミット・差分・復元が
          使えます。
        </p>
        <p className="text-gray-600">
          何度実行しても安全です。前回から変わっていなければ何もしません。
        </p>
      </div>

      {/* 実行結果は redirect の ?done= で受ける (savedHref と同じく、
          リロードで再実行されない形にする)。冪等なので厳密な一回性は不要 */}
      {done === "imported" && (
        <p className="rounded bg-green-50 px-3 py-2 text-green-800">
          取り込みました。
        </p>
      )}
      {done === "noop" && (
        <p className="rounded bg-gray-100 px-3 py-2 text-gray-600">
          変更はありませんでした (取り込み済みです)。
        </p>
      )}

      <form action={backfillHistoryAction}>
        <button type="submit" className={PRIMARY_BUTTON_CLASS}>
          取り込みを実行
        </button>
      </form>
    </div>
  );
}
