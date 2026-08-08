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

// カードの状態 (docs/60-学習進捗計画.md §3)。
//
//   unanswered … まだ解いていない。正解も解説も出ていない
//   answered   … 選択肢を押した。○ / × と正解・解説が出る
//   revealed   … 降参して解説だけ開いた。正解は出るが ○ / × の判定は出ない
//
// 2 値 (選んだ番号 | null) から 3 値へ広げたのは、「解答した」と「解説を
// 開いた」を番号 1 つで表せないため。null 以外に番外の番号を入れて区別する
// 案は、選択肢の番号と衝突しないことを呼ぶ側が守り続ける約束になる
export type QuizState =
  | { kind: "unanswered" }
  | { kind: "answered"; choice: number }
  | { kind: "revealed" };

const UNANSWERED: QuizState = { kind: "unanswered" };

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

// 降参 (docs/60 §3)。**選択肢と見た目を分ける**のが要点 — 同じ枠付きボタンで
// 並べると、6 番目の選択肢に見えて誤って押される。文字リンク調にして
// 「選ぶ物ではない」ことを形で示す
const GIVE_UP_BUTTON_CLASS =
  "mt-2 min-h-11 self-start px-1 text-left text-blue-600 underline transition active:bg-blue-50 print:hidden";

// 押して解ける問題カード (docs/58-CBT問題集計画.md §3)。
//
// **解答するまで正解と解説を出さない**のがこの部品の本体 — 本試験 (CBT) と
// 同じ手順で解けるようにするための出し分けである。全く分からない問題のために
// 「解説を見る」で解説だけ開ける道も用意してあるが、これは意図して押す 1 つの
// ボタンなので、隠す目的 (うっかり目に入らない) は壊れない。
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
  const [state, setState] = useState<QuizState>(UNANSWERED);
  const done = state.kind !== "unanswered";
  const feedback = useRef<HTMLDivElement>(null);

  // 解答すると押した選択肢が disabled になり、キーボード操作ではフォーカスが
  // body へ落ちてしまう。正誤の知らせへ移して、そこから読み進められるようにする
  // (画面に出たことを支援技術へ伝える役目も兼ねる)。降参のときも同じ —
  // 押したボタン自体が消えるので、行き先が無いと同様にフォーカスを失う
  useEffect(() => {
    if (done) {
      feedback.current?.focus();
    }
  }, [done]);

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
              className={choiceClassOf(number, state, answer)}
              disabled={done}
              onClick={() => setState({ kind: "answered", choice: number })}
            >
              <span className={CHOICE_NUMBER_CLASS}>
                {markOf(number, state, answer)}({number})
              </span>
              <span>{choice}</span>
            </button>
          );
        })}
        {/* 未解答のときだけ出す。解説が開いた後に残っていても意味がない */}
        {!done && (
          <button
            type="button"
            className={GIVE_UP_BUTTON_CLASS}
            onClick={() => setState({ kind: "revealed" })}
          >
            解説を見る
          </button>
        )}
      </div>

      {/* live region は**中身より先に置いておく** — 中身ごと後から挿入すると
          変化として拾わない読み上げソフトがある。tabIndex は解答後にここへ
          フォーカスを移すため (押した選択肢が disabled になるので) */}
      <div aria-live="polite" ref={feedback} tabIndex={-1}>
        {done && (
          <>
            <p className={`mt-3 font-medium ${verdictOf(state, answer).className}`}>
              {verdictOf(state, answer).text}
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
              onClick={() => setState(UNANSWERED)}
            >
              やり直す
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// 選んだ番号。まだ解いていない / 降参したときは誰も選んでいないので null。
// 下の 3 つがそれぞれ state.kind を覗くのを避けるための 1 か所
function chosenOf(state: QuizState): number | null {
  return state.kind === "answered" ? state.choice : null;
}

export function choiceClassOf(
  number: number,
  state: QuizState,
  answer: number,
): string {
  if (state.kind === "unanswered") {
    return CHOICE_OPEN;
  }
  if (number === answer) {
    return CHOICE_CORRECT;
  }
  // 間違えた選択肢だけを赤くする。選ばなかった外れは目立たせない
  // (降参のときは選んだ物が無いので、正解以外はすべてここへ落ちる)
  return number === chosenOf(state) ? CHOICE_WRONG : CHOICE_PLAIN;
}

// 解答後に選択肢の頭へ添える記号。色だけで正誤を伝えないための目印
export function markOf(
  number: number,
  state: QuizState,
  answer: number,
): string {
  if (state.kind === "unanswered") {
    return "";
  }
  if (number === answer) {
    return "○ ";
  }
  // × は「自分が選んで外した」印。降参では誰も選んでいないので付けない
  return number === chosenOf(state) ? "× " : "";
}

// 選択肢の下に出す知らせ。文面と色は必ず揃うので 1 つの関数が両方返す
// (別々に分岐を書くと、状態を足したときに片方だけ直し忘れる)。
//
// 降参では正誤を名乗らない — 解かなかったものを「不正解」と呼ぶのは事実と違う。
export function verdictOf(
  state: QuizState,
  answer: number,
): { text: string; className: string } {
  const chosen = chosenOf(state);
  if (chosen === null) {
    return { text: `正解は (${answer})`, className: "text-gray-700" };
  }
  return chosen === answer
    ? { text: "正解", className: "text-green-700" }
    : { text: `不正解 — 正解は (${answer})`, className: "text-red-700" };
}
