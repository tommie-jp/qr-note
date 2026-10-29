import type { Metadata } from "next";
import Link from "next/link";
import { PageTransition } from "@/components/chrome/PageTransition";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth/pageGuard";
import { loadBenchStatus } from "@/lib/diag/benchStatus";
import { BenchmarkPanel } from "./BenchmarkPanel";

// 保存した結果を読むだけ。計測は釦で裏に走らせる
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ベンチマーク",
};

// QR-Note ベンチマーク (docs/121-QR-Noteベンチマーク計画.md)。管理者だけ。
//
// 門番は二重 (サーバー情報と同じ): proxy が publicPaths に無いパスを既定で閉じ、
// ページでも requireAdminPage() を重ねる。計測の Action も管理者を見る
export default async function BenchmarkPage() {
  await requireAdminPage();
  const initial = await loadBenchStatus();

  return (
    <PageTransition>
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
        <p className="text-sm text-gray-500">
          QR-Note
          の典型的な処理の速さを、押したときだけ測って保存します。手元で測るときは本番ビルド
          (docs/118 §0-1) で。next dev の数字は本番と比べられません。
        </p>
        <BenchmarkPanel initial={initial} />
      </div>
    </PageTransition>
  );
}
