import { cookies } from "next/headers";
import Link from "next/link";
import { PageTransition } from "@/components/chrome/PageTransition";
import { TrashScreen } from "@/components/trash/TrashScreen";
import { ImageViewerProvider } from "@/components/imageviewer/ImageViewerProvider";
import { ACTION_LINK_CLASS } from "@/components/ui";
import { isProductionEnv } from "@/lib/appEnv";
import { readTrashPrefs } from "@/lib/prefs/searchPrefs";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface TrashPageProps {
  searchParams: Promise<{ sort?: string }>;
}

// ゴミ箱 (二段階削除の 2 段目。docs/12-ゴミ箱計画.md §5)。
// 検索対象外のノートをここだけで一覧し、復元か永久削除かを選ぶ。
//
// 表示形式と並び順は検索一覧と同じ作法で決める (docs/67-ゴミ箱表示形式計画.md):
//   表示形式 … cookie 1 つを検索一覧と共有 (端末ごとの好み)
//   並び順   … URL → ゴミ箱用 cookie → 既定 (削除順)
// (読み方は lib/prefs/searchPrefs.ts の readTrashPrefs)
//
// proxy.ts も未ログインの画面 GET を止めるが、それは楽観的な検査であって
// 唯一の砦にはしない (docs/18 §4)。ここでも requireUser() で確かめる。
export default async function TrashPage({ searchParams }: TrashPageProps) {
  await requireUser();
  const { sort: sortParam } = await searchParams;
  const { sort, view } = readTrashPrefs(await cookies(), sortParam);
  // 一覧は端末が GET /api/trash から引く (docs/123 §4-3)。ここは cookie と門番だけ
  return (
    <PageTransition>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">ゴミ箱</h1>
          <Link
            href="/"
            transitionTypes={["nav-back"]}
            className={ACTION_LINK_CLASS}
          >
            検索へ
          </Link>
        </div>

        <p className="text-gray-600">
          ゴミ箱のノートは検索に出ません。復元すると元どおり検索できます。
        </p>

        {/* 器 (main) がもう画面幅いっぱいなので、カード・masonry を広げる
            細工 (旧 WIDE_RESULTS_CLASS) は要らない (docs/101 §3-3)。
            画像を押すと覆いで大きく見せる (docs/116 §2。ノートのペインが
            無い画面なので常に覆い) */}
        <ImageViewerProvider overlayOnly>
          <TrashScreen sort={sort} serverView={view} isProd={isProductionEnv()} />
        </ImageViewerProvider>
      </div>

    </PageTransition>
  );
}
