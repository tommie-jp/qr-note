import { noteName } from "@/lib/items/noteName";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Item } from "@/generated/prisma/client";
import { CircuitThumb } from "@/components/item/CircuitThumb";
import { MathText } from "@/components/markdown/MathText";
import { NotePreviewFrame } from "@/components/item/NotePreviewFrame";
import { RowThumb } from "@/components/item/RowThumb";
import { ViewerImageButton } from "@/components/imageviewer/ViewerImageButton";
import { RowQuickActionsSlot } from "@/components/item/row-actions/RowActions";
import {
  CARD_EXTRA_THUMB_PX,
  CARD_EXTRA_THUMB_SIZE_CLASS,
  extraThumbClass,
  ROW_SKIP_OFFSCREEN_CLASS,
  rowFace,
  rowTintClass,
  rowTitle,
  showsRowTags,
  stretchedLinkClass,
  THUMB_PX,
  THUMB_SIZE_CLASS,
  type RowText,
  type RowThumbInfo,
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
  // 画面外で描画を飛ばすクラス (ROW_SKIP_OFFSCREEN_CLASS)。中は小と同じ部品で
  // 描くので、表示モードを知るここで決めて渡す
  skipOffscreenClass: string;
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
  // 顔 (右端のサムネ枠) を出さない。ItemRow の hideFace
  hideFace?: boolean;
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

// 行の右端に並べる画像・動画のサムネの帯 (本文の出現順。最大 ROW_THUMB_MAX 枚)。
//
//   小・中 … 同じ寸法で横に並べる。左が 1 枚目 (顔)。
//   大     … 1 枚目は今までの 96px、2 枚目以降は 46px を 2 段に積んで左隣に。
//
// 何枚まで見せるかは行の幅で決まる (extraThumbClass)。
//
// 画像のサムネは押すとビューアで大きく見せ、動画のサムネはビューアで
// 再生する (docs/116 §1・docs/117 §8-6)。ビューアからは ▶ でスライドショーに
// できる。動画もかつてはノートを開いていたが、「動画を押しても
// スライドショーにならない」と言われた (2026-10-28)。
// 選択モード中は行のどこを押しても選択にしたいので釦にしない
// (近道の釦も出ないので印も要らない)。
//
// data-row-thumb … 帯のある行の印 (テストと、帯を探す目印)。
// RowQuickActionsSlot … PC のホバーで出る近道の釦を、帯の左に出す口。
// 回路図・プレビューの顔には付けない (押すとノートが開くので、釦が
// 重なっても困らない)
function ThumbStrip({
  thumbs,
  itemId,
  href,
  view,
  isSelecting,
}: {
  thumbs: RowThumbInfo[];
  itemId: string;
  href: string;
  view: RowViewMode;
  isSelecting: boolean;
}) {
  const cells = thumbs.map((info, index) => {
    const isExtraCard = view === "card" && index > 0;
    const thumb = (
      <RowThumb
        name={info.name}
        isVideo={info.isVideo}
        animate={index === 0}
        sizePx={isExtraCard ? CARD_EXTRA_THUMB_PX : THUMB_PX[view]}
        sizeClass={isExtraCard ? CARD_EXTRA_THUMB_SIZE_CLASS : THUMB_SIZE_CLASS[view]}
      />
    );
    return (
      <span key={info.name} className={extraThumbClass(view, index)}>
        {isSelecting ? (
          thumb
        ) : (
          <ViewerImageButton
            target={{ itemId, name: info.name, href }}
            className="shrink-0 rounded"
          >
            {thumb}
          </ViewerImageButton>
        )}
      </span>
    );
  });
  const [first, ...rest] = cells;
  return (
    <div
      data-row-thumb={isSelecting ? undefined : view}
      // relative … 近道の釦 (RowQuickActionsSlot) をこの帯の左に置く基準
      className="relative flex shrink-0 gap-1 self-center"
    >
      {view === "card" ? (
        <>
          {rest.length > 0 && (
            <div className="grid grid-flow-col grid-rows-2 gap-1">{rest}</div>
          )}
          {first}
        </>
      ) : (
        cells
      )}
      {!isSelecting && <RowQuickActionsSlot />}
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
    case "image":
      return (
        <ThumbStrip
          thumbs={face.thumbs}
          itemId={item.itemId}
          href={href}
          view={view}
          isSelecting={Boolean(checkbox)}
        />
      );
    case "circuit":
      return (
        <CircuitThumb
          variant="row"
          hash={face.hash}
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
    thumb: input.hideFace ? null : renderThumb(input),
    linkClass: stretchedLinkClass(Boolean(checkbox)),
    tintClass: rowTintClass(selected),
    skipOffscreenClass: ROW_SKIP_OFFSCREEN_CLASS[view],
  };
}
