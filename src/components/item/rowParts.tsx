import Link from "next/link";
import type { ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { CircuitThumb } from "@/components/item/CircuitThumb";
import { MathText } from "@/components/MathText";
import { NotePreviewFrame } from "@/components/item/NotePreviewFrame";
import { RowThumb } from "@/components/item/RowThumb";
import {
  rowFace,
  rowTintClass,
  rowTitle,
  showsRowTags,
  stretchedLinkClass,
  THUMB_PX,
  THUMB_SIZE_CLASS,
  type RowText,
  type RowViewMode,
} from "@/lib/items/itemRowDecor";
import { tagSearchHref } from "@/lib/markdown/tags/tags";

// カードと小・中表示の行が共通に並べる部品 (ItemRow が 1 度だけ組む)。
// 何を出すかの判断は lib/items/itemRowDecor.ts、ここは React の形にするだけ
export interface RowParts {
  itemNo: string;
  // ノートを開くリンク先 (ItemRow の href)
  href: string;
  // プレビューペインでこのノートが開いているか
  selected: boolean;
  // 選択モードで先頭に差し込むチェックボックス
  checkbox?: ReactNode;
  title: ReactNode;
  // タグの行。出さない表示では false
  tags: ReactNode;
  // 補助行 (膜より前に出す包み込み済み)
  footer: ReactNode;
  // 右端のサムネ枠の中身。顔が無ければ null
  thumb: ReactNode;
  // 見出しのリンクに足す当たり判定の膜 (stretched link)
  linkClass: string;
  // 行の地色 (プレビュー中の選択色 / hover)
  tintClass: string;
}

interface RowPartsInput {
  item: Item;
  href: string;
  checkbox?: ReactNode;
  view: RowViewMode;
  footer?: ReactNode;
  circuitThumb?: string;
  mathTitle?: string;
  notePreview?: ReactNode;
  selected: boolean;
}

export function renderRowText(text: RowText): ReactNode {
  return text.kind === "math" ? <MathText html={text.html} /> : text.text;
}

function RowTags({ tags }: { tags: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      {tags.map((tag) => (
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
}

// 顔の優先順位は rowFace (lib/items/itemRowDecor.ts) が持つ
function renderThumb(
  input: Pick<RowPartsInput, "item" | "view" | "circuitThumb" | "notePreview">,
): ReactNode {
  const { item, view, circuitThumb, notePreview } = input;
  const face = rowFace(item, { circuitThumb, hasNotePreview: Boolean(notePreview) });
  switch (face?.kind) {
    case "image":
      return (
        <RowThumb
          name={face.name}
          isVideo={face.isVideo}
          sizePx={THUMB_PX[view]}
          sizeClass={THUMB_SIZE_CLASS[view]}
        />
      );
    case "circuit":
      return (
        <CircuitThumb
          variant="row"
          svg={face.svg}
          sizeClass={THUMB_SIZE_CLASS[view]}
        />
      );
    case "preview":
      // 枠の寸法は NotePreviewFrame が持つ (キャンバスと縮小率と釣り合う組で
      // 持たないとずれるため。THUMB_SIZE_CLASS と同じ値を別に定義している)
      return <NotePreviewFrame view={view}>{notePreview}</NotePreviewFrame>;
    default:
      return null;
  }
}

export function buildRowParts(input: RowPartsInput): RowParts {
  const { item, href, checkbox, view, footer, mathTitle, selected } = input;
  return {
    itemNo: item.itemNo,
    href,
    selected,
    checkbox,
    title: renderRowText(rowTitle(item, mathTitle)),
    tags: showsRowTags(view, item.tags) && <RowTags tags={item.tags} />,
    // 補助行は膜 (stretched link) の上に出す。下に居るとボタンを押しても
    // ノートが開いてしまう — タグを relative z-10 にしているのと同じ理由。
    // 呼ぶ側に任せず、ここで包んで敷き忘れを防ぐ
    footer: footer && <div className="relative z-10 mt-1">{footer}</div>,
    thumb: renderThumb(input),
    linkClass: stretchedLinkClass(Boolean(checkbox)),
    tintClass: rowTintClass(selected),
  };
}
