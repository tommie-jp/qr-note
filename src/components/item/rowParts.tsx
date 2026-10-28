import { noteName } from "@/lib/items/noteName";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { CircuitThumb } from "@/components/item/CircuitThumb";
import { MathText } from "@/components/markdown/MathText";
import { NotePreviewFrame } from "@/components/item/NotePreviewFrame";
import { RowThumb } from "@/components/item/RowThumb";
import { ViewerImageButton } from "@/components/imageviewer/ViewerImageButton";
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
  itemId: string;
  // 読み上げで名乗るノートの呼び名 (lib/items/noteName.ts)
  name: string;
  // 押した瞬間に読み込み中の器へ出す題 (docs/86 §4-18。panes/noteHint.ts)。
  // name は読み上げ用に鉤括弧で包んであるので使わない。題の無いノートは
  // undefined (印を付けず、器は骨組みだけ)
  hintTitle: string | undefined;
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
          // 先読みしない (docs/118 §5)。行ごとに複数あるので数が多い
          prefetch={false}
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
  input: Pick<
    RowPartsInput,
    "item" | "href" | "checkbox" | "view" | "circuitThumb" | "notePreview"
  >,
): ReactNode {
  const { item, href, checkbox, view, circuitThumb, notePreview } = input;
  const face = rowFace(item, { circuitThumb, hasNotePreview: Boolean(notePreview) });
  switch (face?.kind) {
    case "image": {
      const thumb = (
        <RowThumb
          name={face.name}
          isVideo={face.isVideo}
          sizePx={THUMB_PX[view]}
          sizeClass={THUMB_SIZE_CLASS[view]}
        />
      );
      // 選択モード中は行のどこを押しても選択にしたいので包まない
      // (近道の釦も出ないので印も要らない)
      if (checkbox) {
        return thumb;
      }
      // 画像のサムネは押すとビューアで大きく見せ、動画のサムネはビューアで
      // 再生する (docs/116 §1・docs/117 §8-6)。ビューアからは ▶ でスライドショーに
      // できる。動画もかつてはノートを開いていたが、「動画を押しても
      // スライドショーにならない」と言われた (2026-10-28)。
      // data-row-thumb … PC のホバーで出る近道の釦 (RowActionButtons) が、
      // この印を見てサムネの左へ退く。回路図・プレビューの顔には付けない
      // (押すとノートが開く。退くと題の末尾に釦がかぶるだけ)
      return (
        <ViewerImageButton
          target={{ itemId: item.itemId, name: face.name, href }}
          className="shrink-0 self-center rounded"
          dataRowThumb={view}
        >
          {thumb}
        </ViewerImageButton>
      );
    }
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
    itemId: item.itemId,
    name: noteName(item),
    hintTitle: item.title.trim() || undefined,
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
