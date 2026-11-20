"use client";

import { useEffect } from "react";
import { markSecretSearchedQuery } from "@/lib/secret/searchPrivacy";
import { useSecretSearch } from "@/lib/secret/searchSession";

// シークレット内検索が入っている間の検索語に「端末に残さない」印を付ける
// (docs/130 §6)。印を見るのは一覧の控えを IndexedDB に書く側
// (lib/client/listPersist.ts)。
//
// **一致の節 (SecretSearchHits) ではなく一覧の根で呼ぶ。** 節は結果が届いてから
// しか描かれないが、印は「その語で一覧を引いた」時点で要る — 打ちかけの語の
// 一覧も控えに入るため。語を打ってからトグルを入れた場合も、状態が変わった
// 時点のいまの語に印が付く。
export function useSecretQueryMark(query: string): void {
  const { status } = useSecretSearch();
  useEffect(() => {
    if (status !== "off") {
      markSecretSearchedQuery(query);
    }
  }, [status, query]);
}
