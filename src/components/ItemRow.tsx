import Link from "next/link";
import type { ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { firstThumbInfo } from "@/lib/memoImages";
import { CircuitThumb } from "./CircuitThumb";
import { MathText } from "./MathText";
import { NotePreviewFrame } from "./NotePreviewFrame";
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
  // 削除後に戻る検索状態。**スワイプ削除を渡すなら必須** — 無いと
  // trashItemsAction の redirect 先が素の / になり、「検索して 1 件消したら
  // 全件の先頭に居た」になる。渡し忘れはスワイプごと無効にして受ける
  // (下の swipeEnabled)。黙って間違った所へ飛ばすより、機能が出ないほうが気づける。
  //
  // ゴミ箱の一覧 (docs/67-ゴミ箱表示形式計画.md §3) はスワイプ削除を出さない
  // ので、検索状態そのものを持たない
  searchState?: RowSearchState;
  // 行の下に足す補助行 (ゴミ箱の削除日時と復元 / 永久削除)。
  // 押せる物を入れられるよう、stretched link の膜より前に出して描く
  footer?: ReactNode;
  // 画像サムネが無いノートの代わりの顔にする回路図
  // (docs/68-一覧回路図サムネ計画.md §3)。サーバで描画・検査済みの SVG 文字列。
  // 一覧側 (circuitThumbs.ts) が「本文の最初に描画済みの図」を選んで降ろす。
  // **画像があるノートでは使わない** — 優先順位の分岐は下の thumb が持つ
  circuitThumb?: string;
  // 数式入りのタイトル/プレビューの KaTeX 済み HTML (docs/69-一覧数式計画.md)。
  // サーバ (mathText.ts) が数式を含むノートにだけ作って降ろす。
  // 無ければ従来どおりプレーンテキスト (title / preview) で出す
  mathTitle?: string;
  mathPreview?: string;
  // 画像も回路図も無いノートの顔にする、ノート全体の縮小プレビュー
  // (docs/71-一覧ノートプレビュー計画.md)。サーバ (buildNotePreviews) が
  // 描いた ReactNode を受けて NotePreviewFrame で縮める。
  // **画像・回路図があるノートでは使わない** — 優先順位の分岐は下の thumb が持つ
  notePreview?: ReactNode;
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
  footer,
  circuitThumb,
  mathTitle,
  mathPreview,
  notePreview,
}: ItemRowProps) {
  const isUrl = item.mode === "url";
  // 見出しが空でも文字を置く。**当たり判定のため**で、飾りではない —
  // 見出しのリンクは stretched link の基準 (::after inset-0) なので、中身が
  // 空だと箱ごと高さ 0 になり、行のどこを押してもノートが開かなくなる。
  // 画像だけのノートやゴミ箱の空ノートで実際に起きる
  // 数式入りは KaTeX 済み HTML を優先する。math 側があるときは memoSummary /
  // memoPreview を呼ばない — この部品は client 束にも入るので、捨てるだけの
  // 本文パースを SSR と hydration の 2 回やらないため。
  // mathTitle が来るのは要約が数式を含むとき (mathText.ts の足切り) なので、
  // 「(空のノート)」の受け皿と衝突しない
  const titleText = mathTitle ? (
    <MathText html={mathTitle} />
  ) : (
    (isUrl ? item.url : memoSummary(item.memo)) || "(空のノート)"
  );
  // URL モードのノートには本文も貼った画像も無い (memo が空)
  const previewText = mathPreview ? (
    <MathText html={mathPreview} />
  ) : isUrl ? (
    ""
  ) : (
    memoPreview(item.memo)
  );
  // サムネにできる添付 (画像 or 動画 poster)。音声・PDF・テキストは thumb を
  // 持たないので null (一覧では文字だけ)。動画は poster を出し、無ければ
  // RowThumb がアイコンへ切り替える (docs/14 §Phase4)
  const thumbInfo = isUrl ? null : firstThumbInfo(item.memo);

  // 顔の優先順位: 画像/動画 → 回路図 → ノート全体プレビュー (docs/68 §1、
  // docs/70)。画像・回路図があるノートは今までどおりの見た目を保ち、
  // 文字だけだったノートにだけ本文の縮小プレビューが加わる
  const thumb = thumbInfo ? (
    <RowThumb
      name={thumbInfo.name}
      isVideo={thumbInfo.isVideo}
      sizePx={THUMB_PX[view]}
      sizeClass={THUMB_SIZE_CLASS[view]}
    />
  ) : circuitThumb ? (
    <CircuitThumb
      variant="row"
      svg={circuitThumb}
      sizeClass={THUMB_SIZE_CLASS[view]}
    />
  ) : notePreview ? (
    // 枠の寸法は NotePreviewFrame が持つ (キャンバスと縮小率と釣り合う組で
    // 持たないとずれるため。THUMB_SIZE_CLASS と同じ値を別に定義している)
    <NotePreviewFrame view={view}>{notePreview}</NotePreviewFrame>
  ) : null;

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

  // スワイプ削除は非選択 (checkbox なし) のときだけ。prop が揃って初めて
  // 有効にする — ItemList が小/大表示のときだけ降ろしてくる (docs/43 §9-4)。
  const swipeEnabled = Boolean(
    swipeTrashAction && onSwipeOpenChange && searchState && !checkbox,
  );

  // 補助行は膜 (stretched link) の上に出す。下に居るとボタンを押しても
  // ノートが開いてしまう — タグを relative z-10 にしているのと同じ理由。
  // 呼ぶ側に任せず、ここで包んで敷き忘れを防ぐ
  const footerRow = footer && (
    <div className="relative z-10 mt-1">{footer}</div>
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
              {titleText}
            </Link>
          </div>
          {/* タグが無くても行の高さは取る。隣のカードと本文の始まる位置が
              揃わないと、並べたときに行がガタつく */}
          <div className="mt-0.5 min-h-4">{tags}</div>
          {previewText && (
            // 行数は CSS で決める。Markdown 上の 1 行は折り返して 2 行にも
            // なるため、抽出側で数えても画面の行数とは一致しない
            <p className="mt-1 line-clamp-3 text-sm text-gray-500">
              {previewText}
            </p>
          )}
          {footerRow}
        </div>
        {thumb}
      </div>
    );

    if (swipeEnabled && swipeTrashAction && onSwipeOpenChange && searchState) {
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
          {titleText}
        </Link>
        {tags && <div className="mt-0.5">{tags}</div>}
        {footerRow}
      </div>
      {thumb}
    </div>
  );

  if (swipeEnabled && swipeTrashAction && onSwipeOpenChange && searchState) {
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
