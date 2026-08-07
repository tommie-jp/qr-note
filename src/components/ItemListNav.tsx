import Link from "next/link";
import { buildItemUrl, buildSearchUrl } from "@/lib/searchUrl";
import type { Sort } from "@/lib/validation";
import { ACTION_LINK_CLASS, SECONDARY_BUTTON_CLASS } from "./ui";

interface ItemListNavProps {
  // 一覧での隣 (items.ts の findListNeighbors)。端では null
  prev: string | null;
  next: string | null;
  // 持ち回している検索状態。行き先の URL にも同じものを載せて連鎖させる
  query: string;
  sort: Sort;
}

// 一覧の中を「前 / 次」で移る (docs/60-学習進捗計画.md §4)。
//
// ブラウザの戻る/進む (履歴) とは別物で、辿るのは**いま見ている検索結果の
// 並び**。`is:todo` で絞っていれば学習済みのノートは自然に飛ばされる —
// スキップの実装を別に持たない。
//
// 前後は開くたびに数え直す (findListNeighbors)。ノートを開いている間に
// チェックを付けて一覧から外れても、「次」は正しく次のノートを指す。
export function ItemListNav({ prev, next, query, sort }: ItemListNavProps) {
  // 一覧の文脈が無い (QR シールから直接開いた) ときだけ丸ごと出さない。
  // **前後が居ないことでは畳まない** — 1 件しか当たらない検索でも
  // 「一覧へ」は意味を持つ (これが無いと戻る手段が履歴だけになる)
  if (!query) {
    return null;
  }

  return (
    <nav
      aria-label="一覧の中の移動"
      className="mt-4 flex items-center justify-between gap-2 print:hidden"
    >
      <NavSlot itemNo={prev} query={query} sort={sort} direction="prev" />

      {/* 「次」を続けて押した後、一覧へ戻るのにブラウザの戻るを何度も押させない */}
      <Link
        href={buildSearchUrl(query, 1, sort)}
        transitionTypes={["nav-back"]}
        className={ACTION_LINK_CLASS}
      >
        一覧へ
      </Link>

      <NavSlot itemNo={next} query={query} sort={sort} direction="next" />
    </nav>
  );
}

const LABEL = { prev: "← 前", next: "次 →" } as const;

// 端では**押せない見た目のまま場所だけ取る**。行き先が無いたびに消えると、
// 隣の「一覧へ」が動いて押し間違える。無効の見た目は SECONDARY_BUTTON_CLASS が
// 持つ disabled: 指定に任せる (アプリ内の他の無効ボタンと同じ濃さになる)
function NavSlot({
  itemNo,
  query,
  sort,
  direction,
}: {
  itemNo: string | null;
  query: string;
  sort: Sort;
  direction: "prev" | "next";
}) {
  if (itemNo === null) {
    return (
      <button type="button" disabled className={SECONDARY_BUTTON_CLASS}>
        {LABEL[direction]}
      </button>
    );
  }
  return (
    <Link
      href={buildItemUrl(itemNo, query, sort)}
      transitionTypes={[direction === "prev" ? "nav-back" : "nav-forward"]}
      className={SECONDARY_BUTTON_CLASS}
    >
      {LABEL[direction]}
    </Link>
  );
}
