import type { Item } from "@/generated/prisma/client";
// 値の import は不可 — components/item/NotePreviewThumb.tsx はサーバ専用 module
// (offline/circuits.ts と同じ線引き)。型は erase されるので安全。
// 回路図サムネと数式の型は、サーバ専用の circuit/thumbs.ts / markdown/mathText.ts ではなく
// 型だけの葉 (circuit/types.ts / markdown/mathTextTypes.ts) から取る
import type { CircuitThumbMap } from "@/lib/circuit/types";
import type { MathTextMap } from "@/lib/markdown/mathTextTypes";
import type { NotePreviewMap } from "../item/NotePreviewThumb";
import { formatJstDateTime } from "@/lib/datetime";
import { DEFAULT_VIEW_MODE, type ViewMode } from "@/lib/prefs/viewMode";
import { ConfirmSubmitButton } from "../chrome/ConfirmSubmitButton";
import { ImageMasonry, tileCountOf } from "../item/ImageMasonry";
import { TrashTileMenuProvider } from "../item/row-actions/TileActions";
import { purgeConfirmMessage } from "./purgeConfirm";
import { ItemRow } from "../item/ItemRow";
import { ACTION_LINK_CLASS, DANGER_BUTTON_CLASS } from "../ui";

type TrashAction = (formData: FormData) => void | Promise<void>;

interface TrashListProps {
  items: Item[];
  // 表示形式 (docs/67-ゴミ箱表示形式計画.md §3)。切替そのものは下部バーが
  // 持つので、ここは受け取って描き分けるだけ (ItemList と同じ)
  view?: ViewMode;
  restoreAction: TrashAction;
  purgeAction: TrashAction;
  emptyTrashAction: TrashAction;
  // itemNo → 描画済み回路図の SVG (docs/68-一覧回路図サムネ計画.md §5)。
  // 部品 (ItemRow / ImageMasonry) は検索一覧と共有だが、データはページごとに
  // 配線が要る — trash/page.tsx が loadCircuitThumbs で引いて降ろす
  circuitThumbs?: CircuitThumbMap;
  // itemNo → 数式入りタイトル/プレビューの KaTeX 済み HTML
  // (docs/69-一覧数式計画.md)。こちらも trash/page.tsx が作って降ろす
  mathTexts?: MathTextMap;
  // itemNo → ノート全体の縮小プレビュー (docs/71-一覧ノートプレビュー計画.md)。
  // 消してよいかの判断材料は検索一覧より要るので、ゴミ箱でも同じ顔を出す
  notePreviews?: NotePreviewMap;
}

// ゴミ箱からノートを開くリンク。検索一覧と違って持ち回す検索状態が無いので
// (ゴミ箱に検索窓もページ送りも無い)、素の /item/<番号> になる
const itemHref = (itemNo: string) => `/item/${encodeURIComponent(itemNo)}`;

// 1 行ぶんの補助行 (削除日時と復元 / 永久削除)。ItemRow の footer に差し込む。
//
// **行ごとに 1 つの form** で、既定の action は復元 (安全な方)。永久削除は
// formAction で上書きし、confirm を挟む。DB を引かないので静的にテストできる。
function RowActions({
  item,
  restoreAction,
  purgeAction,
}: {
  item: Item;
  restoreAction: TrashAction;
  purgeAction: TrashAction;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {/* 削除日時。並び替えの既定 (削除順) が何を見ているかでもある */}
      {item.deletedAt && (
        <p className="font-mono text-sm text-gray-500">
          削除: {formatJstDateTime(item.deletedAt)}
        </p>
      )}
      <form className="flex items-center gap-1" action={restoreAction}>
        <input type="hidden" name="itemNo" value={item.itemNo} />
        <button type="submit" className={ACTION_LINK_CLASS}>
          復元
        </button>
        <ConfirmSubmitButton
          formAction={purgeAction}
          confirmMessage={purgeConfirmMessage(item.itemNo)}
          className={DANGER_BUTTON_CLASS}
        >
          永久削除
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}

// ゴミ箱の一覧 (docs/12-ゴミ箱計画.md §5、docs/67-ゴミ箱表示形式計画.md)。
//
// 描画は検索一覧と同じ部品 (ItemRow / ImageMasonry) に委ねる。ゴミ箱にも
// 「写真で思い出す」「本文を読んで確かめる」は同じだけ要る — むしろ消してよいか
// の判断は一覧より慎重なので、見えるものが少ない理由がない。
//
// 行ごとの復元 / 永久削除は、小・大表示では行の下にボタンで、画像表示では
// タイルの ⋮ のメニューに出す (docs/107 §9)。画像表示のタイルは「画像 1 枚
// = 1 リンク」で同じノートが何枚も並ぶので、永久削除をボタンで並べると
// 取り返しの付かない操作がタイルの数だけ重複する。メニューに畳み、確認文で
// 「まとめて消える」と言う。
export function TrashList({
  items,
  view = DEFAULT_VIEW_MODE,
  restoreAction,
  purgeAction,
  emptyTrashAction,
  circuitThumbs,
  mathTexts,
  notePreviews,
}: TrashListProps) {
  if (items.length === 0) {
    return (
      <p className="rounded border border-gray-200 bg-white px-4 py-6 text-center text-gray-500">
        ゴミ箱は空です
      </p>
    );
  }

  // 画像表示はタイルを敷き詰めるので、行の枠も区切り線も持たない。
  // 小・大の器は ItemList と同じ (docs/23 §1、docs/32 §1)
  const listClass =
    view === "card"
      ? "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))]"
      : "divide-y divide-gray-200 rounded border border-gray-200 bg-white";

  return (
    <div className="space-y-3">
      {/* 永久削除は itemNo を解放する。古いシールが別の部品を指しうるので、
          「部品もシールも処分済み」のときだけ押す操作だと明示する (§4) */}
      <p className="rounded bg-yellow-50 px-3 py-2 text-yellow-800">
        永久削除すると元に戻せません。その番号は新しいノートに再利用されるため、
        貼ってあるシールも処分してから削除してください。
      </p>

      <form className="flex justify-end">
        <ConfirmSubmitButton
          formAction={emptyTrashAction}
          confirmMessage={`ゴミ箱の ${items.length} 件をすべて完全に削除します。元に戻せません。`}
          className={DANGER_BUTTON_CLASS}
        >
          ゴミ箱を空にする ({items.length})
        </ConfirmSubmitButton>
      </form>

      {view === "image" && (
        <UntiledNotice items={items} circuitThumbs={circuitThumbs} />
      )}
      {view === "image" ? (
        <TrashTileMenuProvider
          restoreAction={restoreAction}
          purgeAction={purgeAction}
        >
          <ImageMasonry
            items={items}
            itemHref={itemHref}
            circuitThumbs={circuitThumbs}
            mathTexts={mathTexts}
            tileActions
          />
        </TrashTileMenuProvider>
      ) : (
        <ul className={listClass}>
          {items.map((item) => (
            <ItemRow
              key={item.itemNo}
              item={item}
              href={itemHref(item.itemNo)}
              view={view}
              circuitThumb={circuitThumbs?.[item.itemNo]?.[0]}
              mathTitle={mathTexts?.[item.itemNo]?.title}
              mathPreview={mathTexts?.[item.itemNo]?.preview}
              notePreview={notePreviews?.[item.itemNo]}
              footer={
                <RowActions
                  item={item}
                  restoreAction={restoreAction}
                  purgeAction={purgeAction}
                />
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// 画像表示で見えないノートの案内 (docs/107 §9)。
//
// 画像も描画済みの回路図も無いノートはタイルにならない。黙って消えていると
// 「ゴミ箱から消えた」「戻せない」と読める (「空にする」の件数には入っている
// のに一覧に居ない)。居ないものだけを数えて、見られる場所を言う
function UntiledNotice({
  items,
  circuitThumbs,
}: {
  items: Item[];
  circuitThumbs?: CircuitThumbMap;
}) {
  const untiled = items.filter(
    (item) => tileCountOf(item, circuitThumbs) === 0,
  ).length;
  if (untiled === 0) {
    return null;
  }
  return (
    <p className="text-sm text-gray-500">
      画像・回路図の無いノート {untiled} 件は画像表示に出ません。
      小・大表示に切り替えると、復元・永久削除できます。
    </p>
  );
}
