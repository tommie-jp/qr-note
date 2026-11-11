"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { searchHrefKeepingView } from "@/components/search/resultViewHref";
import { navigate } from "@/lib/client/navigation";
import { activeResultView } from "@/modules/registry";

// ヘッダーのロゴ (ホームへのリンク)。
//
// 検索結果をカレンダーなどの表示で出しているときは、ホーム (検索語なしの一覧) へ
// 行かずに**その表示を出し直す** (docs/126 §1-24): 同じ検索語・同じ月の検索画面へ
// 戻り (ノートを開いていれば閉じる)、表示の控えを古くして取り直させる。
// 修飾キー付き・中クリックは素のリンクのまま (新しいタブで開くなど)
export function HomeLink({ className, children }: { className: string; children: ReactNode }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const params = new URLSearchParams(location.search);
    const view = activeResultView(params);
    if (view === null) {
      return;
    }
    event.preventDefault();
    navigate(searchHrefKeepingView(params));
    view.refresh?.();
  };
  return (
    <Link href="/" className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
