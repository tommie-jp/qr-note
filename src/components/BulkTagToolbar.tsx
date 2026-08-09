"use client";

import type { Item } from "@/generated/prisma/client";
import { selectedTagsUnion } from "@/lib/bulkTags";
import { OfflinePinIcon, TrashIcon } from "./MenuIcons";
import { DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./ui";

interface BulkTagToolbarProps {
  items: Item[];
  selected: Set<string>;
  // ノートをゴミ箱へ入れるサーバーアクション。同じ form のまま formAction で
  // 送り先だけ差し替える (bulkTagAction に mode 分岐を足さない)
  trashAction: (formData: FormData) => void | Promise<void>;
  // 選択したノートをオフラインの対象にするサーバーアクション
  // (docs/65-オフライン対応計画.md §7)。trashAction と同じ差し替え方
  pinAction: (formData: FormData) => void | Promise<void>;
  onSelectAll: () => void;
  onClear: () => void;
  onCancel: () => void;
}

// 選択モードのツールバー (親の <form action={bulkTagAction}> の中に置く)。
// 追加は入力欄 + 「追加」送信ボタン、削除は選択アイテムが持つタグをチップ
// (それ自体が送信ボタン name=removeTag) にして押されたタグだけを消す。
// どちらのボタンが押されたかでサーバー側が add / remove を判別する。
//
// 最下段はノート自体をゴミ箱へ入れるボタン (docs/12-ゴミ箱計画.md §5)。
// タグ操作とは別の行に分け、「タグを削除」チップと区別する。
export function BulkTagToolbar({
  items,
  selected,
  trashAction,
  pinAction,
  onSelectAll,
  onClear,
  onCancel,
}: BulkTagToolbarProps) {
  const count = selected.size;
  const removable = selectedTagsUnion(items, selected);
  const disabled = count === 0;

  return (
    <div className="space-y-2 rounded border border-blue-200 bg-blue-50 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">{count} 件を選択中</span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-blue-600 underline"
          >
            全選択
          </button>
          <button
            type="button"
            onClick={onClear}
            className="text-blue-600 underline"
          >
            解除
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-600 underline"
          >
            やめる
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          name="addTags"
          placeholder="追加するタグ (例: bjt npn)"
          autoComplete="off"
          disabled={disabled}
          className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={disabled}
          className="whitespace-nowrap rounded bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-50"
        >
          追加
        </button>
      </div>

      {removable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-600">タグを削除:</span>
          {removable.map((tag) => (
            <button
              key={tag}
              type="submit"
              name="removeTag"
              value={tag}
              className="rounded-full bg-white px-2 py-0.5 text-blue-700 ring-1 ring-inset ring-gray-300 hover:bg-red-50 hover:text-red-700 hover:ring-red-300"
            >
              #{tag} ✕
            </button>
          ))}
        </div>
      )}

      {/* ノート自体への操作。タグ操作と混ざらないよう線で区切って最下段に置く。
          持ち出し (左) と削除 (右) を両端に離すのは、押し間違いの距離を稼ぐため。
          ゴミ箱行きは復元できるので confirm は出さない (永久削除は /trash 側) */}
      <div className="flex items-center justify-between border-t border-blue-200 pt-2">
        {/* 選択したノートを ZIP で書き出す (docs/28-エクスポート計画.md §7)。
            親フォームはサーバーアクション宛だが、**文字列の formAction を持つ
            送信ボタンはブラウザの素の送信に戻る** (React はこのとき
            preventDefault しない)。画面遷移のまま Content-Disposition を
            受けるので、JS がファイル全体をメモリに抱えずに済む。
            チェックボックス (name="itemNo") がそのまま本体へ渡り、
            scope はこのボタン自身の name/value で送られる */}
        <button
          type="submit"
          formAction="/api/export"
          formMethod="post"
          name="scope"
          value="selected"
          disabled={disabled}
          className={`${SECONDARY_BUTTON_CLASS} whitespace-nowrap`}
        >
          ⬇ エクスポート
        </button>
        {/* 選んだノートをまとめてオフラインの対象にする (docs/65 §7)。
            **文字を残すのは「押した結果が端末の外に出ない」から** — 絵だけだと
            エクスポート (⬇) と向きの似た絵が並ぶうえ、これは通信量を使う操作
            なので、押す前に何が起きるか読めるほうがよい。「オフライン」では
            3 つ並ぶ最下段が窮屈になるので「オフ」まで詰める */}
        <button
          type="submit"
          formAction={pinAction}
          disabled={disabled}
          title="選択したノートをオフラインで使えるようにする"
          className={`${SECONDARY_BUTTON_CLASS} whitespace-nowrap`}
        >
          <OfflinePinIcon />
          オフ
        </button>
        {/* ゴミ箱は**絵だけ**にする。行アクション (docs/66) と同じ絵で、
            意味は既に覚えられている物なので文字が要らない。3 つ並ぶ最下段で
            一番幅を返せるのがここでもある。
            aria-label と title で、読み上げと長押しには言葉を残す */}
        <button
          type="submit"
          formAction={trashAction}
          disabled={disabled}
          aria-label="ゴミ箱へ"
          title="ゴミ箱へ"
          className={`${DANGER_BUTTON_CLASS} whitespace-nowrap`}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
