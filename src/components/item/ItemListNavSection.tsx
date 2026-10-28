import { Suspense } from "react";
import { ItemListNav } from "@/components/item/ItemListNav";
import {
  findItemNeighbors,
  type ListParams,
} from "@/lib/prefs/itemListContext";

// 一覧の中の「前 / 次」を、ノートの枠を待たせずに後から出す (docs/86 §4-18)。
//
// 前後を数えるには検索を 1 回流す (findListNeighbors)。本文と並べて待つと、
// その分だけ押してから枠が出るまでが伸びる。ナビは本文の下にあるので、
// 遅れて現れても読んでいる場所は動かない — fallback は何も出さない
//
// 一覧の文脈が無い (QR シールから直接開いた) ときは検索も流さない
export function ItemListNavSection({
  itemId,
  params,
}: {
  itemId: string;
  params: ListParams;
}) {
  if (!params.query) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <Neighbors itemId={itemId} params={params} />
    </Suspense>
  );
}

async function Neighbors({
  itemId,
  params,
}: {
  itemId: string;
  params: ListParams;
}) {
  const neighbors = await findItemNeighbors(itemId, params);
  return (
    <ItemListNav
      prev={neighbors.prev}
      next={neighbors.next}
      query={params.query}
      sort={params.sort}
    />
  );
}
