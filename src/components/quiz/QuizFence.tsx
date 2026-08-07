import { parseQuiz } from "@/lib/quizParse";
import { QuizCard } from "./QuizCard";
import { QuizMarkdown } from "./QuizMarkdown";

interface QuizFenceProps {
  code: string;
}

// ```quiz フェンスを問題カードに差し替える (docs/58-CBT問題集計画.md §1)。
//
// 解くのは押したときの出し分けだけ (QuizCard) で、中身の markdown は**ここで
// 描いてから**カードへ渡す。カードを client 部品にしつつ、問題文と選択肢は
// サーバでも描けるようにするため — 印刷や JS を待つ間も、問題そのものは読める。
export function QuizFence({ code }: QuizFenceProps) {
  const quiz = parseQuiz(code);

  // 書き方の誤りは「何が悪いか」と元のソースを添えて出す (CircuitDiagram と
  // 同じ作法)。黙ってコードブロックに落とすと、書いた本人が気付けない
  if ("error" in quiz) {
    return (
      <div className="my-4 rounded border border-red-300 bg-red-50 p-3">
        <p className="text-red-700">問題の書き方のエラー: {quiz.error}</p>
        <pre className="mt-2 overflow-x-auto text-sm text-gray-700">{code}</pre>
      </div>
    );
  }

  return (
    <QuizCard
      question={<QuizMarkdown markdown={quiz.question} />}
      choices={quiz.choices.map((choice, index) => (
        <QuizMarkdown key={index} markdown={choice} inline />
      ))}
      answer={quiz.answer}
      explanation={
        quiz.explanation === null ? null : (
          <QuizMarkdown markdown={quiz.explanation} />
        )
      }
    />
  );
}
