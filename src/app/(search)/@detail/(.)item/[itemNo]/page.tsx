import { ItemListNav } from "@/components/ItemListNav";
import { ItemView } from "@/components/ItemView";
import { LoginRequiredNotice } from "@/components/LoginRequiredNotice";
import { PreviewPane } from "@/components/PreviewPane";
import { PublicItemView } from "@/components/PublicItemView";
import { isProductionEnv } from "@/lib/appEnv";
import { getItem } from "@/lib/items";
import { resolveItemListContext } from "@/lib/itemListContext";
import { isPublicItem } from "@/lib/publicItem";
import { buildItemUrl } from "@/lib/searchUrl";
import { currentUser } from "@/lib/session";
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

// ペインの地色。本番=灰 / ローカル=ピンク (LOCAL の目印はプレビューでも
// 失わない)。env はサーバでしか読めないので、ここで決めて渡す
const paneBg = () => (isProductionEnv() ? "bg-gray-50" : "bg-pink-50");

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
  // 不正な番号でも黙って消えない (全画面側の notFound() と対)。notFound()
  // にしないのは、スロットの 404 が検索画面ごと壊すため。本文に手書きした
  // 壊れたリンクを押したときの受け皿
  if (!isValidItemNo(itemNo)) {
    return (
      <PreviewPane bgClass={paneBg()}>
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          不正な部品番号です。
        </p>
      </PreviewPane>
    );
  }

  const { q, sort: sortParam, saved } = await searchParams;
  const [user, item, ctx] = await Promise.all([
    currentUser(),
    getItem(itemNo),
    resolveItemListContext(itemNo, q, sortParam),
  ]);

  // セッション切れでも黙って消えない (全画面側の分岐と同じ受け皿を
  // ペインの器で出す)。proxy は /item を素通しするので、ここが門番
  if (user === null) {
    return (
      <PreviewPane
        bgClass={paneBg()}
        openHref={`/item/${encodeURIComponent(itemNo)}`}
      >
        {isPublicItem(item) ? (
          <PublicItemView itemNo={itemNo} item={item} />
        ) : (
          <LoginRequiredNotice />
        )}
      </PreviewPane>
    );
  }

  return (
    // key … ノート間をペインのまま移ったとき器を作り直し、前のノートの
    // スクロール位置を持ち越さない
    <PreviewPane
      key={itemNo}
      bgClass={paneBg()}
      itemNo={itemNo}
      openHref={buildItemUrl(itemNo, ctx.query, ctx.sort)}
    >
      <ItemView itemNo={itemNo} item={item} saved={saved} />
      {/* ペインの中の「前 / 次」も Link なのでまた横取りされ、ペインのまま
          一覧の並びを歩ける */}
      <ItemListNav
        prev={ctx.neighbors.prev}
        next={ctx.neighbors.next}
        query={ctx.query}
        sort={ctx.sort}
      />
    </PreviewPane>
  );
}
