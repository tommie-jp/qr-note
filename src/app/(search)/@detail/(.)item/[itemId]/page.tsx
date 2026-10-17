import { ItemDetail, paneBgClass } from "@/components/item/ItemDetail";
import { PreviewPane } from "@/components/panes/PreviewPane";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { resolveItemKey } from "@/lib/items/resolve";

export const dynamic = "force-dynamic";

interface ItemPreviewPageProps {
  params: Promise<{ itemId: string }>;
  // q / sort … 一覧から開いたときに持ち回している検索状態
  // (item/[itemId]/page.tsx と同じ形)。前後ナビの計算に使う
  searchParams: Promise<{
    q?: string | string[];
    sort?: string | string[];
    // 編集の保存 → /item への redirect が横取りされて来たときのトースト印
    saved?: string;
  }>;
}

// /item へのソフト遷移を検索画面の中で受け止めるプレビュー (docs/86 §2)。
// URL は /item/<id> のまま、下部のペイン (1 ペインでは全画面オーバーレイ)
// にノートを出す。リロード・共有・QR シールはハードロードなので横取りされず、
// 従来どおり全画面の item/[itemId]/page.tsx に着く。
//
// **RecordAccess は置かない** (docs/86 §3)。一覧で流し見するたびに
// accessedAt が動くと「最近見た順」が「最近カーソルが通った順」になる。
// 進めたければ「全画面で開く」(ハード遷移) で素の /item へ。
export default async function ItemPreviewPage({
  params,
  searchParams,
}: ItemPreviewPageProps) {
  const { itemId: key } = await params;
  // 旧番号 (/item/1003。シールのスキャンや教科書の本文リンク) もここで解く
  // (docs/107 §3-2)。全画面側 (pageGuard) と違って redirect しない — ペインの
  // 中で転送すると検索画面ごと遷移してしまう。1 件に決まればそのノートを出し、
  // URL は旧番号のまま残す (再読み込みすれば全画面側が id の URL へ付け替える)
  const user = await currentUser();
  const resolution = await resolveItemKey(key, { publicOnly: user === null });
  // 不正な番号でも黙って消えない (全画面側の notFound() と対)。notFound()
  // にしないのは、スロットの 404 が検索画面ごと壊すため。本文に手書きした
  // 壊れたリンクを押したときの受け皿
  if (resolution.kind === "invalid") {
    return (
      <PreviewPane bgClass={paneBgClass()}>
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          不正なノートの指定です。
        </p>
      </PreviewPane>
    );
  }
  if (resolution.kind === "search") {
    return (
      <PreviewPane bgClass={paneBgClass()}>
        <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          #{key} のノートを 1 件に決められませんでした。{" "}
          <Link href={resolution.href} className="underline">
            検索で探す
          </Link>
        </p>
      </PreviewPane>
    );
  }
  const itemId = resolution.itemId;

  const { q, sort, saved } = await searchParams;
  return (
    <ItemDetail
      itemId={itemId}
      q={q}
      sort={sort}
      saved={saved}
      shell={{ kind: "pane" }}
    />
  );
}
