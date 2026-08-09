import type { Item } from "@/generated/prisma/client";
import { formatJstDateTime } from "@/lib/datetime";
import { DEFAULT_VIEW_MODE, type ViewMode } from "@/lib/viewMode";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";
import { ImageMasonry } from "./ImageMasonry";
import { ItemRow } from "./ItemRow";
import { ACTION_LINK_CLASS, DANGER_BUTTON_CLASS } from "./ui";

type TrashAction = (formData: FormData) => void | Promise<void>;

interface TrashListProps {
  items: Item[];
  // 表示形式 (docs/67-ゴミ箱表示形式計画.md §3)。切替そのものは下部バーが
  // 持つので、ここは受け取って描き分けるだけ (ItemList と同じ)
  view?: ViewMode;
  restoreAction: TrashAction;
  purgeAction: TrashAction;
  emptyTrashAction: TrashAction;
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
          confirmMessage={`#${item.itemNo} を完全に削除します。元に戻せず、この番号は新しいノートに再利用されます。シールも処分済みですか?`}
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
// 行ごとの復元 / 永久削除は小・大表示だけに出す。画像表示のタイルは
// 「画像 1 枚 = 1 リンク」でノート単位ではなく (1 ノートに複数枚あれば全部並ぶ)、
// 同じ番号の永久削除ボタンがタイルの数だけ並ぶことになる。取り返しの付かない
// 操作を重複して置く形なので、あちらはノートを開く導線だけにする。
export function TrashList({
  items,
  view = DEFAULT_VIEW_MODE,
  restoreAction,
  purgeAction,
  emptyTrashAction,
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

      {view === "image" ? (
        <>
          {/* 行ごとの操作が無いことを言っておく。黙って消えていると
              「画像表示にしたら復元できなくなった」と読める */}
          <p className="text-sm text-gray-500">
            画像表示では行ごとの操作を出しません。復元はノートを開くか、
            小・大表示に切り替えてください。
          </p>
          <ImageMasonry items={items} itemHref={itemHref} />
        </>
      ) : (
        <ul className={listClass}>
          {items.map((item) => (
            <ItemRow
              key={item.itemNo}
              item={item}
              href={itemHref(item.itemNo)}
              view={view}
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
