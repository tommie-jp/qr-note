import { ItemDetail, paneBgClass } from "@/components/item/ItemDetail";
import { PreviewPane } from "@/components/panes/PreviewPane";
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
  // 不正な番号でも黙って消えない (全画面側の notFound() と対)。notFound()
  // にしないのは、スロットの 404 が検索画面ごと壊すため。本文に手書きした
  // 壊れたリンクを押したときの受け皿
  if (!isValidItemNo(itemNo)) {
    return (
      <PreviewPane bgClass={paneBgClass()}>
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          不正な部品番号です。
        </p>
      </PreviewPane>
    );
  }

  const { q, sort, saved } = await searchParams;
  return (
    <ItemDetail
      itemNo={itemNo}
      q={q}
      sort={sort}
      saved={saved}
      shell={{ kind: "pane" }}
    />
  );
}
