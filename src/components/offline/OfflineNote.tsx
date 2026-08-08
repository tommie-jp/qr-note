"use client";

import { ItemTags } from "@/components/ItemTags";
import { ItemUrlBox } from "@/components/ItemUrlBox";
import { MarkdownView } from "@/components/MarkdownView";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui";
import { formatJstDateTime } from "@/lib/datetime";
import type { OfflineItem } from "@/lib/offline/item";

interface OfflineNoteProps {
  item: OfflineItem;
  onBack: () => void;
}

// 端末に持ち出したノート 1 件を読む画面 (docs/65-オフライン対応計画.md)。
//
// **読むことしかできない。** 編集・ゴミ箱・公開切り替え・履歴はどれも
// サーバへの書き込みか別ルートへの遷移で、圏外では必ず失敗する。押せるのに
// 何も起きないボタンを並べるより、初めから出さない (PublicItemView と同じ判断)。
//
// 描けない物が 2 つある。どちらも黙って欠けるのではなく、そう見えるだけ:
//   - ```circuitikz … TeX (WASM) の描画はサーバ側の仕事で、結果を渡せない。
//     ただのコードブロックとして出る (MarkdownView の circuits 省略時の挙動)
//   - シークレット断片 … 復号鍵はパスキー (PRF) 越しで、サーバの口が要る
//
// タグはリンクにしない (linked={false})。飛び先のタグ検索は別ルートで、
// 圏外では開けないため — 公開ビューがタグをリンクにしない理由と同じ。
export function OfflineNote({ item, onBack }: OfflineNoteProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">
          item <span className="font-mono">#{item.itemNo}</span>
        </h1>
        <button type="button" onClick={onBack} className={SECONDARY_BUTTON_CLASS}>
          一覧へ戻る
        </button>
      </div>

      {item.url && <ItemUrlBox url={item.url} />}

      <ItemTags tags={item.tags} linked={false} />

      <div className="rounded border border-gray-200 bg-white px-4 py-3">
        <MarkdownView markdown={item.memo} linkTags={false} />
      </div>

      {/* 「いつ時点のノートか」は、圏外で読むときこそ知りたい情報になる */}
      <p className="text-sm text-gray-500">
        更新: {formatJstDateTime(new Date(item.updatedAt))}
      </p>
    </div>
  );
}
