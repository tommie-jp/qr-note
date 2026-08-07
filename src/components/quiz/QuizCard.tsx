"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface QuizCardProps {
  question: ReactNode;
  // 選択肢の中身 (番号は含まない)。添字 0 が選択肢 1
  choices: ReactNode[];
  // 正解の番号 (1 始まり)
  answer: number;
  explanation: ReactNode | null;
}

// min-h-11 (44px) は指で狙える最小。**解答後の見た目にも持たせる** —
// ここだけ外すと、押した瞬間に選択肢が縮んで画面が跳ねる
const CHOICE_BASE =
  "flex min-h-11 w-full items-start gap-2 rounded border px-3 py-2 text-left transition";

// 未解答。押せることが判るよう押した感を返す
const CHOICE_OPEN = `${CHOICE_BASE} border-gray-300 bg-white active:scale-[0.99] active:bg-gray-100`;

// 解答後。色で正誤を伝えるが、色だけに頼らず記号 (○ ×) も添える
// (色覚や白黒印刷で伝わらなくなるため)
const CHOICE_CORRECT = `${CHOICE_BASE} border-green-600 bg-green-50`;
const CHOICE_WRONG = `${CHOICE_BASE} border-red-600 bg-red-50`;
const CHOICE_PLAIN = `${CHOICE_BASE} border-gray-200 bg-white text-gray-500`;

// 本試験 (CBT) と同じ (1)〜(5) の見え方にするための番号欄。
// 幅を固定して選択肢の文字の頭を揃える
const CHOICE_NUMBER_CLASS = "shrink-0 font-medium tabular-nums";

// 紙には出さない (印刷した問題集で押せるものは意味を持たない)
const RETRY_BUTTON_CLASS =
  "mt-3 min-h-11 rounded border border-gray-300 bg-white px-3 font-medium text-gray-700 transition active:scale-95 active:bg-gray-100 print:hidden";

// 押して解ける問題カード (docs/58-CBT問題集計画.md §3)。
//
// **解答するまで正解と解説を出さない**のがこの部品の本体 — 本試験 (CBT) と
// 同じ手順で解けるようにするための出し分けである。
//
// 解答した状態は state だけに持ち、保存しない。単語帳のチェックボックス
// (docs/55) と違い、演習は毎回まっさらから解き直すものだから。保存を伴わない
// ので、公開ビューでも印刷でも同じものを描いてよい (押せるかどうかが違うだけ)。
export function QuizCard({
  question,
  choices,
  answer,
  explanation,
}: QuizCardProps) {
  // 選んだ番号 (1 始まり)。null なら未解答
  const [selected, setSelected] = useState<number | null>(null);
  const isCorrect = selected === answer;
  const feedback = useRef<HTMLDivElement>(null);

  // 解答すると押した選択肢が disabled になり、キーボード操作ではフォーカスが
  // body へ落ちてしまう。正誤の知らせへ移して、そこから読み進められるようにする
  // (画面に出たことを支援技術へ伝える役目も兼ねる)
  useEffect(() => {
    if (selected !== null) {
      feedback.current?.focus();
    }
  }, [selected]);

  return (
    <div className="my-4 rounded border border-gray-300 bg-white p-3">
      {question}
      <div className="mt-2 flex flex-col gap-2">
        {choices.map((choice, index) => {
          const number = index + 1;
          return (
            <button
              key={number}
              type="button"
              className={choiceClassOf(number, selected, answer)}
              disabled={selected !== null}
              onClick={() => setSelected(number)}
            >
              <span className={CHOICE_NUMBER_CLASS}>
                {markOf(number, selected, answer)}({number})
              </span>
              <span>{choice}</span>
            </button>
          );
        })}
      </div>

      {/* live region は**中身より先に置いておく** — 中身ごと後から挿入すると
          変化として拾わない読み上げソフトがある。tabIndex は解答後にここへ
          フォーカスを移すため (押した選択肢が disabled になるので) */}
      <div aria-live="polite" ref={feedback} tabIndex={-1}>
        {selected !== null && (
          <>
            <p
              className={`mt-3 font-medium ${isCorrect ? "text-green-700" : "text-red-700"}`}
            >
              {isCorrect ? "正解" : `不正解 — 正解は (${answer})`}
            </p>
            {explanation !== null && (
              <div className="mt-2 border-t border-gray-200 pt-2">
                <p className="font-medium text-gray-700">解説</p>
                {explanation}
              </div>
            )}
            <button
              type="button"
              className={RETRY_BUTTON_CLASS}
              onClick={() => setSelected(null)}
            >
              やり直す
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function choiceClassOf(
  number: number,
  selected: number | null,
  answer: number,
): string {
  if (selected === null) {
    return CHOICE_OPEN;
  }
  if (number === answer) {
    return CHOICE_CORRECT;
  }
  // 間違えた選択肢だけを赤くする。選ばなかった外れは目立たせない
  return number === selected ? CHOICE_WRONG : CHOICE_PLAIN;
}

// 解答後に選択肢の頭へ添える記号。色だけで正誤を伝えないための目印
function markOf(
  number: number,
  selected: number | null,
  answer: number,
): string {
  if (selected === null) {
    return "";
  }
  if (number === answer) {
    return "○ ";
  }
  return number === selected ? "× " : "";
}
