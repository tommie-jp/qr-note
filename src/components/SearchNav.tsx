"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type ReactNode,
} from "react";
import { recordRecentQuery } from "@/lib/searchQueries";
import { buildSearchUrl } from "@/lib/searchUrl";
import type { Sort } from "@/lib/validation";

interface SearchNav {
  // 検索語を URL に反映する (結果はサーバが返す)
  navigate: (query: string) => void;
  // 反映待ち。結果一覧が古いことを示すのに使う
  isPending: boolean;
}

const SearchNavContext = createContext<SearchNav | null>(null);

export function useSearchNav(): SearchNav {
  const context = useContext(SearchNavContext);
  if (!context) {
    throw new Error("useSearchNav は SearchNavProvider の中で使う");
  }
  return context;
}

// 検索窓と結果一覧をまとめて包み、URL の書き換えと待ち状態を共有する
// (docs/11-アプリ的UIUX計画.md §3)。
//
// 「URL が正」は変えない。replace なので 1 文字ごとに履歴が増えることはなく、
// 共有・再読込・戻るは今までどおり動く。scroll: false … 打つたびに先頭へ
// 飛ばされないように。
export function SearchNavProvider({
  sort,
  children,
}: {
  sort: Sort;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (query: string) => {
      startTransition(() => {
        router.replace(buildSearchUrl(query.trim(), 1, sort), { scroll: false });
      });
    },
    [router, sort],
  );

  return (
    <SearchNavContext.Provider value={{ navigate, isPending }}>
      {children}
    </SearchNavContext.Provider>
  );
}

// 反映待ちの間、結果を薄くして「今出ているのは古い結果」と伝える。
// 中身 (件数・特性表・一覧・ページ送り) は Server Component のまま children で受ける。
//
// className … カード表示のとき結果エリアだけを広げるため (WIDE_RESULTS_CLASS)。
// 件数・特性表・一覧・ページ送りが揃って広がらないと、幅が食い違って見える
//
// query … 最近の検索の記録に使う (docs/59-検索候補計画.md §2)。
// **結果のノートを開いたときが、いちばん質の高い記録の契機**。この窓は打つ
// そばから結果が出るので Enter を押さずに結果を叩く使い方が主で、これが無いと
// ほとんど記録されない。逆に、開いたということは「その検索が良かった」合図。
export function SearchResults({
  children,
  className = "",
  query = "",
}: {
  children: ReactNode;
  className?: string;
  query?: string;
}) {
  const { isPending } = useSearchNav();

  // 結果一覧 (小・大・画像モード) をまとめて包んでいる唯一の client component が
  // ここなので、モードごとに記録を配って回らずに済む。
  // タグリンク (/?q=%23…) には当たらない — タグを叩いたのは「今の検索が
  // 良かった」合図ではないので、これは意図どおり
  const recordOnOpen = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target;
    if (target instanceof Element && target.closest('a[href^="/item/"]')) {
      recordRecentQuery(query);
    }
  };

  return (
    // 傍受するだけで、操作はすべて中のリンクが持つ (キーボードの Enter でも
    // リンクが click を出すので、マウス限定にはならない)
    <div
      aria-busy={isPending}
      onClickCapture={recordOnOpen}
      className={`space-y-2 transition-opacity ${isPending ? "opacity-50" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
