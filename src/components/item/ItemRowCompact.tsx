import Link from "next/link";
import type { RowSwipe } from "@/components/SwipeToTrashRow";
import { MaybeSwipeRow } from "./MaybeSwipeRow";
import type { RowParts } from "./rowParts";

interface ItemRowCompactProps {
  parts: RowParts;
  swipe?: RowSwipe;
}

// 小 (compact) と中 (medium) 表示の 1 行。
//
//   compact … 「#番号 タイトル」の 1 行 + 右端に 1 行ぶんのサムネ。
//   medium  … + 2 行目にタグ + 少し大きいサムネ。
//
// 違いはタグの有無とサムネの寸法だけで、どちらも ItemRow が parts に組んで渡す。
// 枠は ul が持ち区切り線で仕切るので、li は枠を持たない
export function ItemRowCompact({ parts, swipe }: ItemRowCompactProps) {
  const { itemNo, href, selected, checkbox, title, tags, footer, thumb } = parts;
  return (
    <MaybeSwipeRow itemNo={itemNo} swipe={swipe} view="compact">
      {/* relative … タイトルの当たり判定を広げる ::after の基準にする */}
      <div
        className={`relative flex items-baseline gap-3 px-4 py-1.5 transition-colors ${parts.tintClass}`}
      >
        {checkbox}
        <Link
          href={href}
          transitionTypes={["nav-forward"]}
          className="shrink-0 font-mono text-sm font-bold"
        >
          #{itemNo}
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            transitionTypes={["nav-forward"]}
            aria-current={selected ? "page" : undefined}
            className={`block truncate text-sm text-gray-600 ${parts.linkClass}`}
          >
            {title}
          </Link>
          {tags && <div className="mt-0.5">{tags}</div>}
          {footer}
        </div>
        {thumb}
      </div>
    </MaybeSwipeRow>
  );
}
