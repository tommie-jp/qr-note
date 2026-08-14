"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Item } from "@/generated/prisma/client";
// 値の import は不可 — circuitThumbs.ts / mathText.ts / NotePreviewThumb.tsx は
// サーバ専用 module (offline/circuits.ts と同じ線引き)。型は erase されるので安全
import type { CircuitThumbMap } from "@/lib/circuitThumbs";
import type { MathTextMap } from "@/lib/mathText";
import type { NotePreviewMap } from "./NotePreviewThumb";
import { buildItemUrl, itemNoFromPathname } from "@/lib/searchUrl";
import type { Sort } from "@/lib/validation";
import { DEFAULT_VIEW_MODE, type ViewMode } from "@/lib/viewMode";
import { BulkTagToolbar } from "./BulkTagToolbar";
import { ImageMasonry } from "./ImageMasonry";
import { ItemRow } from "./ItemRow";
import { usePaneMode } from "./PaneModeProvider";
import { TrashIcon } from "./MenuIcons";
import { useSelectMode } from "./SelectModeProvider";
import { ACTION_LINK_CLASS, PRIMARY_BUTTON_CLASS } from "./ui";

// bulkTagAction をそのまま import すると db.ts (DATABASE_URL 必須) まで巻き込み
// テストが動かないため、サーバーアクションは page.tsx から prop で受け取る。
type BulkTagAction = (formData: FormData) => void | Promise<void>;

interface ItemListProps {
  items: Item[];
  // 一括操作後に戻る検索状態 (hidden で持ち回す)。
  query: string;
  page: number;
  sort: Sort;
  action: BulkTagAction;
  // 表示モード (docs/23-検索結果表示モード計画.md)。切替そのものは
  // 下部バーが持つので、ここは受け取って描き分けるだけ
  view?: ViewMode;
  // 選択したノートをゴミ箱へ入れる (docs/12-ゴミ箱計画.md §5)
  trashAction: BulkTagAction;
  // 選択したノートをオフラインの対象にする (docs/65-オフライン対応計画.md §7)
  pinAction: BulkTagAction;
  // 0 件の検索語をタグにした新規ノートの編集ページ。タグにできない語
  // (URL・複数語) や採番できないときは null。採番はサーバでしか引けないので
  // page.tsx から降ろす (docs/10-スキャン新規登録計画.md)
  registerHref: string | null;
  // 同じ検索条件でゴミ箱に当たった件数 (0 件検索のときだけサーバが数える)
  trashedMatches: number;
  // itemNo → 描画済み回路図の SVG (docs/68-一覧回路図サムネ計画.md §5)。
  // page.tsx (サーバ) が loadCircuitThumbs で引いて降ろす。小/大は先頭 1 枚を
  // 行のサムネに、画像モードは全部をタイルに使う
  circuitThumbs?: CircuitThumbMap;
  // itemNo → 数式入りタイトル/プレビューの KaTeX 済み HTML
  // (docs/69-一覧数式計画.md)。page.tsx (サーバ) が buildMathTexts で作って降ろす
  mathTexts?: MathTextMap;
  // itemNo → ノート全体の縮小プレビュー (docs/71-一覧ノートプレビュー計画.md)。
  // page.tsx (サーバ) が buildNotePreviews で描いて降ろす。画像も回路図も
  // 無いノートの顔になる (優先順位は ItemRow の thumb 分岐が持つ)
  notePreviews?: NotePreviewMap;
}

function emptyState(
  items: Item[],
  query: string,
  registerHref: string | null,
  trashedMatches: number,
  view: ViewMode,
) {
  if (items.length > 0) {
    return null;
  }
  return (
    // カード表示では ul が枠を持たない (グリッドの器でしかない) ので、
    // 案内は自前で枠を張り、全カラムに渡す
    <li
      className={`space-y-3 px-4 py-6 text-center text-gray-500 ${
        view === "card" ? "col-span-full rounded border border-gray-200 bg-white" : ""
      }`}
    >
      <p>該当する部品がありません</p>
      {trashedMatches > 0 && (
        // 消したノートを探して 0 件のときと、ゴミ箱のノートと同じコードを
        // 再スキャンしたときの受け皿。復元は /trash 側で行う
        // (docs/12-ゴミ箱計画.md §5)
        <p>
          <Link
            href="/trash"
            transitionTypes={["nav-forward"]}
            className={`${ACTION_LINK_CLASS} justify-center`}
          >
            <TrashIcon />
            ゴミ箱に {trashedMatches} 件の一致があります
          </Link>
        </p>
      )}
      {registerHref && (
        // 何が作られるか (#コード) を見せる。押しても編集ページが開くだけで、
        // 「更新」を押すまで DB には何も書かない
        <p>
          <Link
            href={registerHref}
            transitionTypes={["nav-forward"]}
            className={`${PRIMARY_BUTTON_CLASS} px-4`}
          >
            <span className="font-mono">#{query}</span> を新規登録
          </Link>
        </p>
      )}
    </li>
  );
}

// 検索結果リスト。選択モードでは各行にチェックボックス、上部に一括タグ付け/
// 削除のツールバーを出す。モードの入り切りは下部バーの「選択」が持つ。
export function ItemList({
  items,
  query,
  page,
  sort,
  action,
  view = DEFAULT_VIEW_MODE,
  trashAction,
  pinAction,
  registerHref,
  trashedMatches,
  circuitThumbs,
  mathTexts,
  notePreviews,
}: ItemListProps) {
  // 選択モードの入り切りは下部バーが持つ (docs/31-下部操作バー計画.md §5-2)。
  // 選んだ番号の Set はここに残す — バーは「何件選ばれたか」を知る必要がなく、
  // 持ち上げても使い道がない
  const { selectMode, exit } = useSelectMode();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // スワイプで開いている行 (docs/43-スワイプ削除計画.md)。開くのは常に 1 行
  // だけにするため、ここで一元管理する。小表示・非選択のときだけ効く。
  const [openItemNo, setOpenItemNo] = useState<string | null>(null);

  // ノートのペイン (docs/86 §4) に出ている番号。ペイン自身が context へ
  // 流したものを見る (docs/86 §4-4) — 3 ペインでは URL が /item から
  // 離れてもノートが出たままなので、pathname だけでは決まらない。
  // provider の外 (ペインのない画面) では pathname に落とす
  const pathname = usePathname();
  const { shownItemNo } = usePaneMode();
  const previewItemNo = shownItemNo ?? itemNoFromPathname(pathname);

  // 選択モードを抜けたら選択を捨てる。バーから抜けることもあるので、
  // 抜ける操作それぞれに後始末を配らず、モードの変化 1 か所で受ける
  const [wasSelectMode, setWasSelectMode] = useState(selectMode);
  if (selectMode !== wasSelectMode) {
    setWasSelectMode(selectMode);
    if (!selectMode) {
      setSelected(new Set());
    }
  }

  const toggle = (itemNo: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemNo)) {
        next.delete(itemNo);
      } else {
        next.add(itemNo);
      }
      return next;
    });

  // 小 … 今までどおりの 1 カラムの一覧 (区切り線で仕切る)。
  // 大 … カードを敷き詰めるグリッド。**カラム数は指定しない**。auto-fill に
  //      任せることで、スマホは 1 列・タブレット/PC は 2 列以上と画面が決める。
  //      20rem を下限にするのは、これより狭いカードではタイトルも本文 3 行も
  //      読めず、密度を上げた意味が無くなるため。
  //
  //      下限が min(20rem, 100%) なのは必須。素の minmax(20rem, 1fr) だと、
  //      器が 20rem より狭い画面 (実測: 320px 端末で器は 273px) でも列が 20rem に
  //      広がり、横スクロールが出る。100% との min を取ることで、狭い画面では
  //      「器いっぱいの 1 列」に畳まれる
  const listClass =
    view === "card"
      ? "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))]"
      : "divide-y divide-gray-200 rounded border border-gray-200 bg-white";

  // 画像モードの行はない (masonry が描く)。選択モード中のフォールバックなど
  // ItemRow に流すときは compact に畳む — ItemRow に 'image' が来ないことを
  // 型 (RowViewMode) で保証する
  const rowView = view === "image" ? "compact" : view;

  // ノートへのリンクに検索状態を載せる (docs/60-学習進捗計画.md §4)。
  // 開いた先で「一覧の前後」を辿れるようにするため。検索していないときは
  // buildItemUrl が素の /item/<番号> に畳むので、今までと同じ URL になる
  const itemHref = (itemNo: string) => buildItemUrl(itemNo, query, sort);

  // 1 件を削除した後に戻る先。**戻り先を持ち回さないと素の / へ飛ばされる** —
  // trashItemsAction は最後に redirect(parseBackUrl(formData)) を呼ぶので、
  // 検索語もページも送らないと「検索して 1 件消したら全件の先頭に居た」に
  // なる。一括削除の側は BulkTagToolbar のフォームが同じ 3 つを hidden で
  // 送っており、こちらだけ抜けていた
  const searchState = { q: query, page, sort };

  // 画像モードは描画を ImageMasonry に丸ごと委譲する (docs/32 §2)。
  //
  //   0 件 (検索ヒットなし) … 該当なしの案内と新規登録/ゴミ箱の導線は
  //     画像モードでも失わない。compact の枠でそのまま出す。
  //   選択モード中 … タイルは画像単位でノート単位ではなく、画像なしノートが
  //     選択対象から漏れるので、下の compact 一覧 (rowView) に畳んで受ける。
  //     抜ければ masonry に戻る (docs/32 §5)
  if (view === "image" && !selectMode) {
    if (items.length === 0) {
      return (
        <ul className={listClass}>
          {emptyState(items, query, registerHref, trashedMatches, "compact")}
        </ul>
      );
    }
    return (
      <ImageMasonry
        items={items}
        itemHref={itemHref}
        circuitThumbs={circuitThumbs}
        mathTexts={mathTexts}
        previewItemNo={previewItemNo}
      />
    );
  }

  if (!selectMode) {
    // スワイプ削除は小・大表示 (docs/43 §9)。画像モードは非選択時に
    // ImageMasonry へ early return するので、ここに来る view は compact/card のみ。
    const swipeEnabled = view === "compact" || view === "card";
    return (
      <ul className={listClass}>
        {items.map((item) => (
          <ItemRow
            key={item.itemNo}
            item={item}
            href={itemHref(item.itemNo)}
            searchState={searchState}
            view={rowView}
            circuitThumb={circuitThumbs?.[item.itemNo]?.[0]}
            mathTitle={mathTexts?.[item.itemNo]?.title}
            mathPreview={mathTexts?.[item.itemNo]?.preview}
            notePreview={notePreviews?.[item.itemNo]}
            selected={item.itemNo === previewItemNo}
            swipeTrashAction={swipeEnabled ? trashAction : undefined}
            swipeOpen={openItemNo === item.itemNo}
            onSwipeOpenChange={
              swipeEnabled
                ? (open) => setOpenItemNo(open ? item.itemNo : null)
                : undefined
            }
          />
        ))}
        {emptyState(items, query, registerHref, trashedMatches, view)}
      </ul>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="q" value={query} />
      <input type="hidden" name="page" value={page} />
      <input type="hidden" name="sort" value={sort} />
      <BulkTagToolbar
        items={items}
        selected={selected}
        trashAction={trashAction}
        pinAction={pinAction}
        onSelectAll={() => setSelected(new Set(items.map((i) => i.itemNo)))}
        onClear={() => setSelected(new Set())}
        onCancel={exit}
      />
      <ul className={listClass}>
        {items.map((item) => (
          <ItemRow
            key={item.itemNo}
            item={item}
            href={itemHref(item.itemNo)}
            searchState={searchState}
            view={rowView}
            circuitThumb={circuitThumbs?.[item.itemNo]?.[0]}
            mathTitle={mathTexts?.[item.itemNo]?.title}
            mathPreview={mathTexts?.[item.itemNo]?.preview}
            notePreview={notePreviews?.[item.itemNo]}
            selected={item.itemNo === previewItemNo}
            checkbox={
              <input
                type="checkbox"
                name="itemNo"
                value={item.itemNo}
                checked={selected.has(item.itemNo)}
                onChange={() => toggle(item.itemNo)}
                aria-label={`#${item.itemNo} を選択`}
                className="size-4 shrink-0 self-center"
              />
            }
          />
        ))}
        {emptyState(items, query, null, 0, view)}
      </ul>
    </form>
  );
}
