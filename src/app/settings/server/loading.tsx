import Link from "next/link";
import { ACTION_LINK_CLASS } from "@/components/ui";

// /settings/server の遷移中に即座に出す待ちの表示
// (docs/109-サーバー情報計画.md §2)。
//
// 収集は DB・/proc・ディスクを待ち、DB が固まっていると節ごとの上限
// (SECTION_TIMEOUT_MS) の 5 秒まで返らない。何も出ないと「押しても何も
// 起きない」ように見えるため、ページ本体と同じ見出しを先に出し、本文の
// 位置で待っていると伝える。ダイアログで覆わない (ユーザーの指示) —
// 「検索へ」も押せるままにして、待ちきれなければ戻れるようにする。
//
// スピナーは灰色の輪: ui.ts のスピナーは白系で、白地の上では見えない
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">サーバー情報</h1>
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
        サーバー情報を取得しています。お待ちください…
      </p>
    </div>
  );
}
