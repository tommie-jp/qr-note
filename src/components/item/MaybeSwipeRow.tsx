import type { ReactNode } from "react";
import { SwipeToTrashRow, type RowSwipe } from "@/components/SwipeToTrashRow";

interface MaybeSwipeRowProps {
  itemNo: string;
  // スワイプ削除の袋。無ければ素の li で包む (選択モード・ゴミ箱の一覧)
  swipe?: RowSwipe;
  view: "compact" | "card";
  // カードの枠 (CARD_FRAME_CLASS)。小・中表示では ul が枠を持つので渡さない
  frameClassName?: string;
  children: ReactNode;
}

// 1 行 / 1 カードの li。スワイプ削除が有効なら SwipeToTrashRow が li を持ち、
// 中身 (children) だけを預ける。カードと小表示の両方の末尾に同じ分岐が
// 並んでいたのをここへ寄せた (docs/43 §9-4)。
//
// 素の li の overflow-hidden … 角丸の枠から中身 (選択色の地・サムネ) を
// はみ出させない。SwipeToTrashRow の li は自前で overflow-hidden を持つ
export function MaybeSwipeRow({
  itemNo,
  swipe,
  view,
  frameClassName,
  children,
}: MaybeSwipeRowProps) {
  if (swipe) {
    return (
      <SwipeToTrashRow
        itemNo={itemNo}
        swipe={swipe}
        view={view}
        liClassName={frameClassName}
      >
        {children}
      </SwipeToTrashRow>
    );
  }
  return (
    <li className={frameClassName && `overflow-hidden ${frameClassName}`}>
      {children}
    </li>
  );
}
