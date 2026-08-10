// ```quiz フェンスの書き方を、編集中にその場で知らせる
// (docs/70-編集ライブプレビュー計画.md §7、docs/58-CBT問題集計画.md §2)。
//
// **診断文は書かない。parseQuiz が持っているものをそのまま出す。**
// あちらの戻り値は既に人に向けた日本語 (「`問:` がありません」「選択肢は
// `正解:` より前に並べてください」) で、閲覧側の問題カードもそれを見せている。
// ここで文言を書き足すと、同じ間違いに 2 通りの説明ができてしまう。
//
// **これが要るのは、間違いに気づく場所が遠いから。** いまは編集タブで書いて
// 閲覧タブへ切り替えて初めて「解けない問題」だと判る。行指向の記法は
// iPhone で手打ちするために選んだもの (docs/58 §2) なので、打ち間違いは
// 起きる前提で、その場で言うほうがよい。
//
// フェンスの言語名そのものの打ち間違い (mermiad 等) は fenceLinter が持つ。
// あちらは「言語名」、こちらは「中身」で、見る場所が違う。

import { syntaxTree } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { QUIZ_LANG } from "@/lib/fenceLanguages";
import { parseQuiz } from "@/lib/quizParse";

// フェンスの原文から言語名と中身を割る。開きと閉じの行は中身に含めない
function quizBody(source: string): string | null {
  const lines = source.split("\n");
  const opening = /^\s*(?:`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[0]);
  if (opening?.[1].toLowerCase() !== QUIZ_LANG) {
    return null;
  }
  const body = lines.slice(1);
  if (body.length > 0 && /^\s*(?:`{3,}|~{3,})\s*$/.test(body[body.length - 1])) {
    body.pop();
  }
  return body.join("\n");
}

export const quizLinter = linter((view: EditorView): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") {
        return;
      }
      const body = quizBody(view.state.doc.sliceString(node.from, node.to));
      if (body === null) {
        return;
      }
      // **書き始めの空フェンスは叱らない。** ```quiz と打った直後は必ず
      // 空で、そこで「問: がありません」と出るのは急かしているだけ
      if (body.trim() === "") {
        return;
      }
      const result = parseQuiz(body);
      if (!("error" in result)) {
        return;
      }
      diagnostics.push({
        from: node.from,
        to: node.to,
        severity: "warning",
        message: result.error,
      });
    },
  });
  return diagnostics;
});
