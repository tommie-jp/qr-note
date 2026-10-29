import { AttributionFooter } from "@/components/chrome/AttributionFooter";
import { EditScreen } from "@/components/editor/EditScreen";
import { PageTransition } from "@/components/chrome/PageTransition";
import { guardItemPage } from "@/lib/auth/pageGuard";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

interface EditPageProps {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ code?: string }>;
}

// Ver1 の /edit/:itemId 相当。本文を編集する (mode / url は docs/110 で廃止)
//
// proxy.ts も未ログインの画面 GET を止めるが、それは楽観的な検査であって
// 唯一の砦にはしない (docs/18 §4)。本文を読む getItem の前に requireUser() で
// 確かめる。
export default async function EditPage({ params, searchParams }: EditPageProps) {
  const itemId = await guardItemPage((await params).itemId, (id) => `/edit/${id}`);
  await requireUser();
  const { code } = await searchParams;

  // 本文は端末が API から引く (docs/123 §4-4)。ここでは DB を引かない
  return (
    <PageTransition>
      <div className="space-y-4">
        <h1 className="text-xl font-bold">
          edit
        </h1>
        <EditScreen itemId={itemId} code={typeof code === "string" ? code : null} />
        {/* 使っている Web サービスの帰属フッター (docs/94・docs/95)。
            JAN 商品情報の結果が実際に現れるのはこの編集画面の事前入力だけなので、
            「API を使う画面の下部」をここで満たす。form の外に置く */}
        <AttributionFooter />
      </div>
    </PageTransition>
  );
}
