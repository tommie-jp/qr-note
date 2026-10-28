import Link from "next/link";
import type { RowSwipe } from "@/components/item/row-actions/SwipeToTrashRow";
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
  const { itemId, name, href, selected, checkbox, title, tags, footer, thumb } = parts;
  return (
    <MaybeSwipeRow itemId={itemId} name={name} swipe={swipe} view="compact">
      {/* relative … タイトルの当たり判定を広げる ::after の基準にする。
          pr-10 … 操作がある行 (swipe あり) は右端に ⋮ が常に居るので、
          サムネと題をその幅 (w-10) だけ左へ寄せる (docs/107 §2) */}
      <div
        className={`relative flex items-baseline gap-3 py-1.5 pl-4 transition-colors ${
          swipe ? "pr-10" : "pr-4"
        } ${parts.tintClass}`}
      >
        {checkbox}
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            // 押した瞬間に読み込み中の器へ題を出す印 (docs/86 §4-18。noteHint.ts)
            data-note-title={parts.hintTitle}
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
