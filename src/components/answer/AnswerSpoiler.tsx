"use client";

import type { ReactNode } from "react";
import { Children, useState } from "react";
import { ANSWER_CLOSED_MARK, ANSWER_OPEN_MARK } from "@/lib/answerSpoiler";
import { useRevealAllAnswers } from "./RevealAllAnswers";
import { VocabAnswer } from "./VocabAnswer";

interface AnswerSpoilerProps {
  children: ReactNode;
  // 答えの直前にある見出し語 (rehypeAnswerTts が刻む)。単語帳の答えなら
  // 発音ボタンを添えるのに使う (docs/81-単語TTS発音計画.md)
  word?: string | null;
}

// 答えが素の文字 1 つなら取り出す。`||` の中は素の文字だけ、というのが
// 記法の約束 (docs/79 §2) なので普通は取れる。取れなければ元のまま描く
function plainText(children: ReactNode): string | null {
  const parts = Children.toArray(children);
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : null;
}

// `||答え||` を押して開く印 (docs/79-答え隠し計画.md)。
//
// **閉じている間は場所を取らない。** 幅を残してぼかす方式は、答えの長さが
// ヒントになってしまう。1 行 1 語の密度 (samples/03 の単語帳) を守るのが
// この記法の目的なので、閉じているときは印 1 文字だけにする。
//
// 開いた状態は保存しない。演習は毎回まっさらから解き直すもの、という
// quiz カード (docs/58 §3) と同じ約束。
export function AnswerSpoiler({ children, word = null }: AnswerSpoilerProps) {
  const [open, setOpen] = useState(false);
  // ノート全体の「答えを表示」。紙の単語帳の赤シートに当たる操作で、
  // 50 語を 1 語ずつ押すより速い
  const revealAll = useRevealAllAnswers();
  const shown = open || revealAll;
  const text = plainText(children);

  return (
    <span className="whitespace-normal">
      <button
        type="button"
        // 押す的を文字より広く取る (指で狙うため。docs/11 §1-4)
        className="px-1 align-baseline text-sky-700 hover:underline"
        aria-expanded={shown}
        // 開いていない答えの中身は DOM に出さないので、読み上げには
        // 「答え」とだけ伝える。開けば下の中身がそのまま読まれる
        aria-label={shown ? "答えを隠す" : "答えを表示"}
        onClick={() => setOpen((prev) => !prev)}
      >
        {shown ? ANSWER_OPEN_MARK : ANSWER_CLOSED_MARK}
      </button>
      {/* 開くまで**描かない**。display:none で持つと、ページ内検索や
          ソースの表示から答えが読めてしまう。印刷にも出ない
          (`:::details` の閉じた中身が出ないのと同じ)。
          発音ボタンも開いた後にだけ出る — 単語を隠したまま音だけ聞けても
          単語帳としては意味がなく、閉じた行の密度も崩したくない */}
      {shown && (
        <span className="text-rose-700">
          {text === null ? children : <VocabAnswer text={text} word={word} />}
        </span>
      )}
    </span>
  );
}
