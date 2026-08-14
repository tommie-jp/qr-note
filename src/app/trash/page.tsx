import { cookies } from "next/headers";
import Link from "next/link";
import {
  emptyTrashAction,
  purgeItemsAction,
  restoreItemsAction,
  setTrashSortAction,
  setViewModeAction,
} from "@/app/actions";
import { PageTransition } from "@/components/PageTransition";
import { TrashActionBar } from "@/components/TrashActionBar";
import { TrashList } from "@/components/TrashList";
import { ACTION_LINK_CLASS, WIDE_RESULTS_CLASS } from "@/components/ui";
import { isProductionEnv } from "@/lib/appEnv";
import { loadCircuitThumbs } from "@/lib/circuitThumbs";
import { listTrashedItems } from "@/lib/items";
import { buildMathTexts } from "@/lib/mathText";
import { buildNotePreviews } from "@/components/NotePreviewThumb";
import { resolveTrashSort, TRASH_SORT_COOKIE } from "@/lib/sortMode";
import {
  parseViewMode,
  usesWideResults,
  VIEW_MODE_COOKIE,
} from "@/lib/viewMode";

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
export default async function TrashPage({ searchParams }: TrashPageProps) {
  const { sort: sortParam } = await searchParams;
  const cookieStore = await cookies();
  const sort = resolveTrashSort(
    sortParam,
    cookieStore.get(TRASH_SORT_COOKIE)?.value,
  );
  const view = parseViewMode(cookieStore.get(VIEW_MODE_COOKIE)?.value);
  const items = await listTrashedItems(sort);
  // 一覧に出す回路図サムネ (docs/68-一覧回路図サムネ計画.md §5)。
  // 検索一覧と同じ: キャッシュ済みの SVG を引くだけで描画はしない
  const circuitThumbs = await loadCircuitThumbs(
    items,
    view === "image" ? "all" : "first",
  );
  // タイトル・プレビューの数式も検索一覧と同じに (docs/69-一覧数式計画.md)。
  // プレビューが描かれるのはカード表示だけ
  const mathTexts = buildMathTexts(items, view === "card" ? "both" : "title");
  // 画像も回路図も無いノートの顔になる、本文の縮小プレビュー
  // (docs/71-一覧ノートプレビュー計画.md)。検索一覧と同じ配線
  const notePreviews = buildNotePreviews(items, circuitThumbs, view);

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

        {/* カード・masonry は広い画面で列を増やしたいので広幅。compact の
            1 カラムだけは読み幅を保つ (検索一覧と同じ。docs/23 §1、docs/32 §1) */}
        <div className={usesWideResults(view) ? WIDE_RESULTS_CLASS : ""}>
          <TrashList
            items={items}
            view={view}
            restoreAction={restoreItemsAction}
            purgeAction={purgeItemsAction}
            emptyTrashAction={emptyTrashAction}
            circuitThumbs={circuitThumbs}
            mathTexts={mathTexts}
            notePreviews={notePreviews}
          />
        </div>
      </div>

      <TrashActionBar
        view={view}
        sort={sort}
        viewAction={setViewModeAction}
        sortAction={setTrashSortAction}
        isProd={isProductionEnv()}
      />
    </PageTransition>
  );
}
