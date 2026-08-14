import { cookies } from "next/headers";
import { ItemListNav } from "@/components/ItemListNav";
import { ItemView } from "@/components/ItemView";
import { PreviewPane } from "@/components/PreviewPane";
import { isProductionEnv } from "@/lib/appEnv";
import { findListNeighbors, getItem } from "@/lib/items";
import { buildItemUrl } from "@/lib/searchUrl";
import { currentUser } from "@/lib/session";
import { SORT_COOKIE, resolveSort } from "@/lib/sortMode";
import { isValidItemNo } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface ItemPreviewPageProps {
  params: Promise<{ itemNo: string }>;
  // q / sort … 一覧から開いたときに持ち回している検索状態
  // (item/[itemNo]/page.tsx と同じ形)。前後ナビの計算に使う
  searchParams: Promise<{
    q?: string | string[];
    sort?: string | string[];
    // 編集の保存 → /item への redirect が横取りされて来たときのトースト印
    saved?: string;
  }>;
}

// /item へのソフト遷移を検索画面の中で受け止めるプレビュー (docs/86 §2)。
// URL は /item/<番号> のまま、右下のペイン (狭い画面では全画面オーバーレイ)
// にノートを出す。リロード・共有・QR シールはハードロードなので横取りされず、
// 従来どおり全画面の item/[itemNo]/page.tsx に着く。
//
// **RecordAccess は置かない** (docs/86 §3)。一覧で流し見するたびに
// accessedAt が動くと「最近見た順」が「最近カーソルが通った順」になる。
// 進めたければ「全画面で開く」(ハード遷移) で素の /item へ。
export default async function ItemPreviewPage({
  params,
  searchParams,
}: ItemPreviewPageProps) {
  const { itemNo } = await params;
  // 不正な番号・未ログインはペインごと出さない。notFound() にしないのは、
  // スロットの 404 が検索画面ごと壊すため。一覧に出た行から来る限りここには
  // 来ない — 公開ノートを匿名で見る道はハードロード (全画面) 側にしかない
  if (!isValidItemNo(itemNo)) {
    return null;
  }

  const [user, item, { q, sort: sortParam, saved }] = await Promise.all([
    currentUser(),
    getItem(itemNo),
    searchParams,
  ]);
  if (user === null) {
    return null;
  }

  // 前後ナビは全画面の item ページと同じ決め方 (URL → cookie → 既定)。
  // ペインの中の「前 / 次」も Link なのでまた横取りされ、ペインのまま
  // 一覧の並びを歩ける
  const query = (Array.isArray(q) ? (q[0] ?? "") : (q ?? "")).trim();
  const sort = resolveSort(sortParam, (await cookies()).get(SORT_COOKIE)?.value);
  const neighbors = query
    ? await findListNeighbors(query, sort, itemNo)
    : { prev: null, next: null };

  return (
    // key … ノート間をペインのまま移ったとき器を作り直し、前のノートの
    // スクロール位置を持ち越さない
    <PreviewPane
      key={itemNo}
      bgClass={isProductionEnv() ? "bg-gray-50" : "bg-pink-50"}
      openHref={buildItemUrl(itemNo, query, sort)}
    >
      <ItemView itemNo={itemNo} item={item} saved={saved} />
      <ItemListNav
        prev={neighbors.prev}
        next={neighbors.next}
        query={query}
        sort={sort}
      />
    </PreviewPane>
  );
}
