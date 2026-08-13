"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

// ノート全体の「答えを表示 / 隠す」(docs/79-答え隠し計画.md §4)。
//
// 紙の単語帳の**赤シート**に当たる操作。50 語を 1 語ずつ押して確かめるのは
// 紙より不便なので、まとめて開ける口を最初から用意する。
//
// 状態は context で配る。サーバで描いた本文を children としてそのまま通すので、
// 本文の描画はサーバのまま (この部品が client なのは状態を持つためだけ)。
const RevealAllContext = createContext(false);

export function useRevealAllAnswers(): boolean {
  return useContext(RevealAllContext);
}

interface RevealAllAnswersProps {
  children: ReactNode;
}

export function RevealAllAnswers({ children }: RevealAllAnswersProps) {
  const [all, setAll] = useState(false);

  return (
    <RevealAllContext.Provider value={all}>
      {/* 本文の上に置く。読み始める前に「開いた状態で読む / 隠して自分を
          試す」を選ぶ操作なので、下端より上端のほうが手順に合う */}
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          className="min-h-11 px-2 text-sm text-sky-700 hover:underline"
          aria-pressed={all}
          onClick={() => setAll((prev) => !prev)}
        >
          {all ? "答えを隠す" : "答えを表示"}
        </button>
      </div>
      {children}
    </RevealAllContext.Provider>
  );
}
