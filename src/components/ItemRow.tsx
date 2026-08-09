import Link from "next/link";
import type { ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { firstThumbInfo } from "@/lib/memoImages";
import { RowThumb } from "./RowThumb";
import {
  SwipeToTrashRow,
  type RowSearchState,
} from "./SwipeToTrashRow";
import { memoPreview } from "@/lib/memoPreview";
import { memoSummary } from "@/lib/memoSummary";
import { tagSearchHref } from "@/lib/tags";
import { DEFAULT_VIEW_MODE, type ViewMode } from "@/lib/viewMode";

// 画像モードは ImageMasonry が描くのでここには来ない (ItemList が
// compact に畳んでから渡す)。型で 'image' を締め出して前提を保証する
export type RowViewMode = Exclude<ViewMode, "image">;

interface ItemRowProps {
  item: Item;
  // ノートを開くリンク先。ItemList が検索状態を載せた URL を組み立てて渡し、
  // ノート側の前後ナビが「一覧のどこに居るか」を復元できるようにする
  // (docs/60-学習進捗計画.md §4)。**任意にしない**: 既定を持たせると、
  // 渡し忘れた一覧で前後ナビだけが黙って消える
  href: string;
  // 選択モードで先頭に差し込むチェックボックス (通常時は undefined)。
  checkbox?: ReactNode;
  // 表示モード (docs/23-検索結果表示モード計画.md)。既定は今までの 2 行表示。
  view?: RowViewMode;
  // 小表示のスワイプ削除 (docs/43-スワイプ削除計画.md)。3 つ揃って初めて
  // 有効になる。選択モード (checkbox あり) やカード表示では渡さない。
  swipeTrashAction?: (formData: FormData) => void | Promise<void>;
  swipeOpen?: boolean;
  onSwipeOpenChange?: (open: boolean) => void;
  // 削除後に戻る検索状態。**任意にしない** — 既定を持たせると、渡し忘れた
  // 一覧で削除のたび素の / へ飛ばされる (href と同じ理由)
  searchState: RowSearchState;
}

// サムネの一辺 (px)。行の高さに合わせる: 小は 2 行分、大は 5 行分。
// width/height 属性にも渡して、読み込み前から場所を取らせる (画像が届いた
// 瞬間に行が飛び跳ねないように)。
const THUMB_PX: Record<RowViewMode, number> = { compact: 40, card: 96 };
const THUMB_SIZE_CLASS: Record<RowViewMode, string> = {
  compact: "size-10",
  card: "size-24",
};

// 検索結果 / 一覧の 1 件。
//
//   compact … 1 行目「#番号 タイトル」/ 2 行目タグ + 右端に小さなサムネ。
//   card    … + 本文プレビュー 3 行 + 大きめのサムネ。
//
// タイトル (memoSummary) と本文 (memoPreview) は同じ規則で切り分けてあり、
// 本文には 1 行目・タグ・プロパティ・画像が出てこない。カードの 3 行に
// 「他の場所で既に見えているもの」を流さないため (memoPreview.ts 参照)。
export function ItemRow({
  item,
  href,
  checkbox,
  view = DEFAULT_VIEW_MODE,
  swipeTrashAction,
  swipeOpen = false,
  onSwipeOpenChange,
  searchState,
}: ItemRowProps) {
  const isUrl = item.mode === "url";
  const title = isUrl ? item.url : memoSummary(item.memo);
  // URL モードのノートには本文も貼った画像も無い (memo が空)
  const preview = isUrl ? "" : memoPreview(item.memo);
  // サムネにできる添付 (画像 or 動画 poster)。音声・PDF・テキストは thumb を
  // 持たないので null (一覧では文字だけ)。動画は poster を出し、無ければ
  // RowThumb がアイコンへ切り替える (docs/14 §Phase4)
  const thumbInfo = isUrl ? null : firstThumbInfo(item.memo);

  const thumb = thumbInfo && (
    <RowThumb
      name={thumbInfo.name}
      isVideo={thumbInfo.isVideo}
      sizePx={THUMB_PX[view]}
      sizeClass={THUMB_SIZE_CLASS[view]}
    />
  );

  const tags = item.tags.length > 0 && (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      {item.tags.map((tag) => (
        <Link
          key={tag}
          href={tagSearchHref(tag)}
          // relative … タイトルの当たり判定 (STRETCHED_LINK_CLASS) の上に出す。
          // 敷いた膜の下に居ると、タグを押してもノートが開いてしまう
          className="relative z-10 text-sm text-blue-700 hover:underline"
        >
          #{tag}
        </Link>
      ))}
    </div>
  );

  // 枠内のどこを押してもノートが開くようにする。
  //
  // 行全体を <a> で包むことはできない。タグは別の行き先 (タグ検索) を持つので
  // リンクの入れ子になり、HTML として不正で挙動も壊れる。そこでリンクは
  // タイトルの 1 つに保ったまま、その ::after を枠いっぱいに広げて当たり判定
  // だけを大きくする (stretched link)。href は本物のリンクのままなので、
  // 中クリックで新しいタブ・右クリックで URL コピーも今までどおり効く。
  //
  // 上に出したい物 (タグ) は relative z-10 で膜より前に出す。
  //
  // **選択モードでは敷かない。** チェックボックスまで膜が覆って押せなくなる
  // うえ、選んでいる最中に枠へ触れるたびノートへ飛んでしまう
  const stretchedLink = checkbox ? "" : "after:absolute after:inset-0";

  // スワイプ削除は非選択 (checkbox なし) のときだけ。3 つの prop が揃って初めて
  // 有効にする — ItemList が小/大表示のときだけ降ろしてくる (docs/43 §9-4)。
  const swipeEnabled = Boolean(
    swipeTrashAction && onSwipeOpenChange && !checkbox,
  );

  if (view === "card") {
    // 1 枚ずつが独立したカード。小表示では ul が枠を持ち区切り線で仕切るが、
    // グリッドに並べるときは ul は器でしかないので、枠と地色は各カードが持つ。
    // スワイプ有効時は SwipeToTrashRow が li を持つので、枠クラスだけ渡す
    // (見た目の定義を 2 か所に散らさない。docs/43 §9-2)。
    const cardFrame = "h-full rounded border border-gray-200 bg-white";
    const cardBody = (
      // relative … タイトルの当たり判定を広げる ::after の基準にする。
      // h-full … グリッドで伸ばされた分を中身にも渡し、隣とサムネの高さを揃える
      <div className="relative flex h-full gap-3 px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100">
        {checkbox}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-2">
            <Link
              href={href}
              transitionTypes={["nav-forward"]}
              className="shrink-0 font-mono font-bold"
            >
              #{item.itemNo}
            </Link>
            <Link
              href={href}
              transitionTypes={["nav-forward"]}
              className={`truncate text-gray-600 ${stretchedLink}`}
            >
              {title}
            </Link>
          </div>
          {/* タグが無くても行の高さは取る。隣のカードと本文の始まる位置が
              揃わないと、並べたときに行がガタつく */}
          <div className="mt-0.5 min-h-4">{tags}</div>
          {preview && (
            // 行数は CSS で決める。Markdown 上の 1 行は折り返して 2 行にも
            // なるため、抽出側で数えても画面の行数とは一致しない
            <p className="mt-1 line-clamp-3 text-sm text-gray-500">{preview}</p>
          )}
        </div>
        {thumb}
      </div>
    );

    if (swipeEnabled && swipeTrashAction && onSwipeOpenChange) {
      return (
        <SwipeToTrashRow
          itemNo={item.itemNo}
          trashAction={swipeTrashAction}
          searchState={searchState}
          isOpen={swipeOpen}
          onOpenChange={onSwipeOpenChange}
          view="card"
          liClassName={cardFrame}
        >
          {cardBody}
        </SwipeToTrashRow>
      );
    }

    return <li className={`overflow-hidden ${cardFrame}`}>{cardBody}</li>;
  }

  // compact の 1 行ぶんの中身 (li の中身)。スワイプ有効時は
  // SwipeToTrashRow が li を持つので、中身だけを渡す。
  const compactBody = (
    // relative … タイトルの当たり判定を広げる ::after の基準にする
    <div className="relative flex items-baseline gap-3 px-4 py-1.5 transition-colors hover:bg-gray-50 active:bg-gray-100">
      {checkbox}
      <Link
        href={href}
        transitionTypes={["nav-forward"]}
        className="shrink-0 font-mono font-bold"
      >
        #{item.itemNo}
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          transitionTypes={["nav-forward"]}
          className={`block truncate text-gray-600 ${stretchedLink}`}
        >
          {title}
        </Link>
        {tags && <div className="mt-0.5">{tags}</div>}
      </div>
      {thumb}
    </div>
  );

  if (swipeEnabled && swipeTrashAction && onSwipeOpenChange) {
    return (
      <SwipeToTrashRow
        itemNo={item.itemNo}
        trashAction={swipeTrashAction}
        searchState={searchState}
        isOpen={swipeOpen}
        onOpenChange={onSwipeOpenChange}
        view="compact"
      >
        {compactBody}
      </SwipeToTrashRow>
    );
  }

  return <li>{compactBody}</li>;
}
