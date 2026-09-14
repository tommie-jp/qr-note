import type { Metadata } from "next";
import { ItemDetail } from "@/components/ItemDetail";
import { recordAccessAction } from "@/app/actions";
import { guardItemPage } from "@/lib/pageGuard";

export const dynamic = "force-dynamic";

// 公開ノートは検索エンジンに載せない (docs/22-ノート公開計画.md §8)。
// 「URL を知っている人に見せる」であって「web に公開する」ではない。
// itemNo は連番なので、1 件でもクロールされると辿られる。
// 既定は狭いほうへ倒しておき、載せたくなったら外す
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface ItemPageProps {
  params: Promise<{ itemNo: string }>;
  // saved … 更新直後だけ付く保存時刻。トーストを出す印 (docs/11 §2-3)
  // q / sort … 一覧から開いたときに持ち回している検索状態。
  //   これがあるときだけ前後ナビを出す (docs/60-学習進捗計画.md §4)。
  //   同じ名前を 2 回書いた URL (`?q=a&q=b`) では配列で届くので、型でも
  //   その形を認め、ItemDetail (resolveItemListContext) が 1 本に畳んでから使う
  searchParams: Promise<{
    saved?: string;
    q?: string | string[];
    sort?: string | string[];
  }>;
}

// QR シールの飛び先。
//
// このページは proxy.ts が**未ログインでも素通しする**口
// (auth/publicPaths.ts の isSelfGuardedPath。docs/22 §1)。素通しした以上、
// 誰に何を見せるかはこのページ (の ItemDetail) が決める。門番を当てにしない。
// 見せ分けの表と「未登録・非公開・ゴミ箱を同じ応答に潰す」理由は ItemDetail.tsx
export default async function ItemPage({ params, searchParams }: ItemPageProps) {
  const { itemNo } = await params;
  guardItemPage(itemNo);
  const { saved, q, sort } = await searchParams;

  return (
    <ItemDetail
      itemNo={itemNo}
      q={q}
      sort={sort}
      saved={saved}
      shell={{ kind: "page", recordAccessAction }}
    />
  );
}
