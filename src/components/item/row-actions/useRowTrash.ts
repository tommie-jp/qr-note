"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { buildTrashFormData } from "@/lib/items/itemSelection";

// 削除後に戻る検索状態。trashItemsAction は最後に redirect(parseBackUrl(...)) を
// 呼ぶので、これを送らないと素の / へ飛ばされ、検索語もページも失われる
// (一括削除は BulkTagToolbar のフォームが hidden で同じ 3 つを送っている)。
export interface RowSearchState {
  q: string;
  page: number;
  sort: string;
}

// ノートをゴミ箱へ入れるサーバーアクション (BulkTagToolbar と同じ trashItemsAction)。
export type RowTrashAction = (formData: FormData) => void | Promise<void>;

// 1 件をゴミ箱へ送る。成功なら true、本物の失敗なら false。
// 行 (useRowTrash) と画像モードのタイル (TileTrashProvider) が共有する。
//
// **成功しても例外は飛んでくる。** trashItemsAction は最後に redirect() を
// 呼び、これは内部エラーを投げることで動く仕組みなので、素の catch は成功
// した削除まで「失敗」にしてしまう (実際、消えた行の上に一瞬エラーが出て
// いた)。フレームワークの例外はここで投げ直す。
// 戻り先 (q/page/sort) も一緒に載る。手で組むと載せ忘れても型では
// 捕まらないので、組み立ては lib の 1 本に寄せてある
export async function sendTrash(
  itemNo: string,
  trashAction: RowTrashAction,
  searchState: RowSearchState,
): Promise<boolean> {
  try {
    await trashAction(buildTrashFormData(itemNo, searchState));
    return true;
  } catch (error) {
    unstable_rethrow(error);
    return false;
  }
}

// 1 行ぶんのゴミ箱行き (docs/43 §6、docs/66 §3)。スワイプの「削除」・
// ホバーのボタン列・長押しメニューの 3 つの入口が同じ trash を呼ぶ。
//
// 送信中・失敗の状態を持てるのが行の階層だけなので、実行する手はここに置く。
//
//   removing … 押した瞬間から畳む (サーバ反映までの間「押したのに残っている」
//              ように見せない)。成功時は revalidate で行ごと消えるまで畳んだまま
//   failed   … 本物の失敗。畳みを戻して行内にエラーを出す
export function useRowTrash(
  itemNo: string,
  trashAction: RowTrashAction,
  searchState: RowSearchState,
) {
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = removing || isPending;

  const trash = () => {
    if (busy) return;
    setFailed(false);
    setRemoving(true);
    startTransition(async () => {
      // 成功時は revalidate で一覧からこの行ごと消えるので、畳んだまま待つ。
      if (await sendTrash(itemNo, trashAction, searchState)) {
        return;
      }
      // 本物の失敗は畳みを戻してエラーを見せる (静かに握りつぶさない)。
      setRemoving(false);
      setFailed(true);
    });
  };

  return { busy, removing, failed, isPending, trash };
}
