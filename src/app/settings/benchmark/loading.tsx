import Link from "next/link";
import { ACTION_LINK_CLASS } from "@/components/ui";

// /settings/benchmark の遷移中に出す待ちの表示 (settings/server/loading.tsx と同じ形)
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">ベンチマーク</h1>
        <Link
          href="/"
          transitionTypes={["nav-back"]}
          className={ACTION_LINK_CLASS}
        >
          検索へ
        </Link>
      </div>
      <p role="status" className="flex items-center gap-3 text-gray-700">
        <span
          aria-hidden
          className="size-5 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700"
        />
        結果を読み込んでいます…
      </p>
    </div>
  );
}
