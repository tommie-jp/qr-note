"use client";

import { ItemTags } from "@/components/ItemTags";
import { ItemUrlBox } from "@/components/ItemUrlBox";
import { NoteBody } from "@/components/NoteBody";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui";
import type { CircuitMap } from "@/lib/circuitCache";
import { formatJstDateTime } from "@/lib/datetime";
import type { OfflineItem } from "@/lib/offline/item";

interface OfflineNoteProps {
  item: OfflineItem;
  // 持ち出した回路図 (docs/65-オフライン対応計画.md §8)。オンラインの ItemView が
  // renderCircuits の結果を渡すのと同じ作法で、こちらは同期で受け取った
  // 描画済みの SVG を渡す
  circuits: CircuitMap;
  onBack: () => void;
}

// 端末に持ち出したノート 1 件を読む画面 (docs/65-オフライン対応計画.md)。
//
// **読むことしかできない。** 編集・ゴミ箱・公開切り替え・履歴はどれも
// サーバへの書き込みか別ルートへの遷移で、圏外では必ず失敗する。押せるのに
// 何も起きないボタンを並べるより、初めから出さない (PublicItemView と同じ判断)。
//
// 回路図とシークレット断片も出る (docs/65-オフライン対応計画.md §8, §9):
//   - ```circuitikz … 描くのはサーバの仕事のままだが、描き終わった SVG を
//     同期で運ぶようにした。まだ描かれていないフェンスだけがコードブロックの
//     まま出る (MarkdownView の circuits 省略時の挙動)
//   - シークレット断片 … 鍵束の写しを端末が持ち、暗号文は Service Worker が
//     持つ。解錠 (Face ID) も復号もこの端末の中で完結する
//
// **編集の導線は出さない** (allowSecretEdit を渡さない)。断片の保存はサーバへの
// 書き込みで、圏外では必ず失敗する — 押せるのに何も起きないボタンを出さない
// のは、この画面の他の判断と同じ。
//
// タグはリンクにしない (linked={false})。飛び先のタグ検索は別ルートで、
// 圏外では開けないため — 公開ビューがタグをリンクにしない理由と同じ。
export function OfflineNote({ item, circuits, onBack }: OfflineNoteProps) {
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
        <NoteBody memo={item.memo} circuits={circuits} linkTags={false} />
      </div>

      {/* 「いつ時点のノートか」は、圏外で読むときこそ知りたい情報になる */}
      <p className="text-sm text-gray-500">
        更新: {formatJstDateTime(new Date(item.updatedAt))}
      </p>
    </div>
  );
}
