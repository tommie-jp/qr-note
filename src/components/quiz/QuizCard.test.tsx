import { describe, expect, test } from "vitest";
import { choiceClassOf, markOf, verdictOf, type QuizState } from "./QuizCard";

// 押した後の見た目は SSR したマークアップでは踏めない (docs/58「テストの届く
// 範囲」)。出し分けの判断はこの 3 つの純関数に寄せてあるので、ここで確かめる。
const unanswered: QuizState = { kind: "unanswered" };
const answered = (choice: number): QuizState => ({ kind: "answered", choice });
const revealed: QuizState = { kind: "revealed" };

const ANSWER = 2;

describe("markOf", () => {
  test("未解答では何も添えない", () => {
    expect(markOf(1, unanswered, ANSWER)).toBe("");
    expect(markOf(2, unanswered, ANSWER)).toBe("");
  });

  test("解答すると正解に ○、選んで外した物に ×", () => {
    expect(markOf(2, answered(1), ANSWER)).toBe("○ ");
    expect(markOf(1, answered(1), ANSWER)).toBe("× ");
    // 選ばなかった外れには何も付けない
    expect(markOf(3, answered(1), ANSWER)).toBe("");
  });

  // 降参では誰も選んでいないので、× を付ける相手が居ない
  test("降参では正解の ○ だけで × は出さない", () => {
    expect(markOf(2, revealed, ANSWER)).toBe("○ ");
    expect(markOf(1, revealed, ANSWER)).toBe("");
    expect(markOf(3, revealed, ANSWER)).toBe("");
  });
});

describe("choiceClassOf", () => {
  test("未解答の選択肢はすべて押せる見た目", () => {
    const open = choiceClassOf(1, unanswered, ANSWER);
    expect(open).toBe(choiceClassOf(2, unanswered, ANSWER));
    // 未解答の時点で正解が色で漏れないこと (CBT の出し分けの本体)
    expect(open).not.toContain("green");
  });

  test("解答すると正解が緑・選んで外した物が赤", () => {
    expect(choiceClassOf(2, answered(1), ANSWER)).toContain("green");
    expect(choiceClassOf(1, answered(1), ANSWER)).toContain("red");
  });

  test("降参では正解が緑になるだけで赤は出ない", () => {
    expect(choiceClassOf(2, revealed, ANSWER)).toContain("green");
    expect(choiceClassOf(1, revealed, ANSWER)).not.toContain("red");
    expect(choiceClassOf(3, revealed, ANSWER)).not.toContain("red");
  });
});

describe("verdictOf", () => {
  test("当たれば正解、外せば正解番号を添える", () => {
    expect(verdictOf(answered(2), ANSWER).text).toBe("正解");
    expect(verdictOf(answered(1), ANSWER).text).toBe("不正解 — 正解は (2)");
  });

  // 解かなかったものを「不正解」と呼ぶのは事実と違う
  test("降参では正誤を名乗らず正解だけ伝える", () => {
    expect(verdictOf(revealed, ANSWER).text).toBe("正解は (2)");
  });

  // 文面と色は必ず揃う (赤い「正解」のような食い違いを作らない)
  test("色は文面と揃う", () => {
    expect(verdictOf(answered(2), ANSWER).className).toContain("green");
    expect(verdictOf(answered(1), ANSWER).className).toContain("red");
    expect(verdictOf(revealed, ANSWER).className).not.toContain("red");
  });
});
