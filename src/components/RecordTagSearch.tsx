"use client";

import { useEffect } from "react";
import { recordQueryUse } from "@/lib/searchQueries";
import { tagSearchQuery } from "@/lib/tags";

// タグ (#…) を押したときの検索を履歴に残す (docs/59-検索候補計画.md §2)。
// RecordAccess と同じく何も描画しない。
//
// **なぜ document で拾うのか。** タグのリンクは一覧の行 (ItemRow)・画像タイル
// (ImageMasonry)・詳細ページ (ItemTags)・メモ本文 (remarkTagLinks) の 4 か所に
// あり、どれも Server Component が描く。押したことを知れるのはクライアントだけ
// なので、4 か所に配って回るより 1 か所で受けるほうが漏れない
// (実際、結果一覧だけを見ていた頃は詳細ページのタグが記録されなかった)。
//
// 拾うのは `/?q=#タグ` の形のリンクだけ (tagSearchQuery)。ページ送りや一覧への
// 戻りは「今見ている検索を続ける」操作なので巻き込まない。
//
// 記録する語はリンク先から取る。押した時点の URL ではない — タグを押すのは
// 「そのタグで探したい」であって、今の検索を認めたわけではないため。
export function RecordTagSearch() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        return;
      }
      // capture で拾うのは、途中で止められる前に記録を済ませるため。
      // 記録は遷移するかどうかと無関係でよい
      const query = tagSearchQuery(target.closest("a")?.getAttribute("href"));
      if (query) {
        recordQueryUse(query);
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  return null;
}
