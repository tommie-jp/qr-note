import Link from "next/link";
import type { RowSwipe } from "@/components/item/row-actions/SwipeToTrashRow";
import {
  CARD_FRAME_CLASS,
  hasRowText,
  type RowText,
} from "@/lib/items/itemRowDecor";
import { MaybeSwipeRow } from "./MaybeSwipeRow";
import { renderRowText, type RowParts } from "./rowParts";

interface ItemRowCardProps {
  parts: RowParts;
  // 本文プレビュー 3 行。カードだけが出す (小・中表示では組まない)
  preview: RowText;
  swipe?: RowSwipe;
}

// 大 (card) 表示の 1 枚。番号と見出し + タグ + 本文プレビュー 3 行 + 大きめのサムネ。
// 枠と地色は各カードが持つ (CARD_FRAME_CLASS)
export function ItemRowCard({ parts, preview, swipe }: ItemRowCardProps) {
  const { itemId, name, href, selected, checkbox, title, tags, footer, thumb } = parts;
  return (
    <MaybeSwipeRow
      itemId={itemId}
      name={name}
      swipe={swipe}
      view="card"
      frameClassName={CARD_FRAME_CLASS}
    >
      {/* relative … タイトルの当たり判定を広げる ::after の基準にする。
          h-full … グリッドで伸ばされた分を中身にも渡し、隣とサムネの高さを揃える */}
      <div
        className={`relative flex h-full gap-3 px-4 py-3 transition-colors ${parts.tintClass}`}
      >
        {checkbox}
        {/* pr-8 … 操作があるカードは右上に ⋮ が居る (高さ 36px で、題の下の
            タグの行まで届く)。サムネが無いと題・タグ・本文が右端まで伸びて
            ⋮ の下に潜るので、列ごと空ける (docs/107 §2)。サムネがあれば ⋮ は
            サムネの角に重なる (白い地を敷いてある) ので空けない — 空けると
            狭いカードで題が無駄に短く切れる */}
        <div
          className={`flex min-w-0 flex-1 flex-col ${swipe && !thumb ? "pr-8" : ""}`}
        >
          <div className="flex items-baseline gap-2">
            <Link
              href={href}
              // 先読みしない (docs/118 §5)。/item は動的経路で、先読みで届くのは
              // 待ち画面までしかなく、本文は押したときに取る。それなのに一覧の
              // 行が画面に入るたびに要求が出て (1 検索で 8〜75 本)、iPhone では
              // 押した直後の要求がその後ろに並んで 287ms 待たされていた
              prefetch={false}
              // 押した瞬間に読み込み中の器へ題を出す印 (docs/86 §4-18。noteHint.ts)
              data-note-title={parts.hintTitle}
              transitionTypes={["nav-forward"]}
              aria-current={selected ? "page" : undefined}
              className={`truncate text-sm text-gray-600 ${parts.linkClass}`}
            >
              {title}
            </Link>
          </div>
          {/* タグが無くても行の高さは取る。隣のカードと本文の始まる位置が
              揃わないと、並べたときに行がガタつく */}
          <div className="mt-0.5 min-h-4">{tags}</div>
          {hasRowText(preview) && (
            // 行数は CSS で決める。Markdown 上の 1 行は折り返して 2 行にも
            // なるため、抽出側で数えても画面の行数とは一致しない
            <p className="mt-1 line-clamp-3 text-sm text-gray-500">
              {renderRowText(preview)}
            </p>
          )}
          {footer}
        </div>
        {thumb}
      </div>
    </MaybeSwipeRow>
  );
}
