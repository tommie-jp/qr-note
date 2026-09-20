"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/lib/errorMessage";
import { type BoardIssue, renderBoardFence } from "@/lib/markdown/boardRender";
import type { BoardLang } from "@/lib/markdown/fenceLanguages";
import { ERROR_SOURCE_CLASS } from "../ui";

// ```breadboard / ```perfboard フェンスを実体配線図として描く (docs/97)。
//
// **ブラウザで描く** — 処理系は 1 枚 1〜11 ms の同期の純関数で、TeX も
// サーバも要らない。mermaid と同じ形にしてあるのはそのため。読み込み・描画・
// 検査は @/lib/markdown/boardRender に寄せた (編集画面のライブプレビューも
// 同じものを呼ぶ)

// 「描けた (render)」「処理系が動かなかった (error)」「描画中 (null)」の 3 つ
type RenderState =
  | { svg: string; issues: readonly BoardIssue[] }
  | { error: string }
  | null;

interface BoardDiagramProps {
  lang: BoardLang;
  code: string;
}

export function BoardDiagram({ lang, code }: BoardDiagramProps) {
  const [state, setState] = useState<RenderState>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rendered = await renderBoardFence(lang, code);
        if (!cancelled) {
          setState(rendered);
        }
      } catch (e) {
        if (!cancelled) {
          setState({ error: errorText(e) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lang, code]);

  // ここに来るのは処理系そのものが動かなかったとき。**読めない本文はここに
  // 来ない** — 板は既定を持つので、読めたところまで描いて issues に出る
  if (state && "error" in state) {
    return (
      <div className="board-diagram rounded border border-red-300 bg-red-50 p-3">
        <p className="text-red-700">図を描けませんでした: {state.error}</p>
        <pre className={ERROR_SOURCE_CLASS}>{code}</pre>
      </div>
    );
  }

  if (!state) {
    return <div className="board-diagram text-gray-500">図を描画中…</div>;
  }

  // 処理系が組んだ SVG (assertSafeSvg の許可リストを通してある) を埋め込む
  return (
    <>
      <div
        className="board-diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
      <BoardIssues issues={state.issues} />
    </>
  );
}

// 読めなかった行とお知らせ。**図とは別に、行番号つきで出す** — 処理系は
// SVG に何も書き込まないので、図を貼っても報告は付いてこない。
//
// 処理系の返す errorHtml (生の HTML) は使わない。独自の class が付いた
// <div> で、SVG の許可リストも掛からない。配列から React で組めば字は逃がされる
function BoardIssues({ issues }: { issues: readonly BoardIssue[] }) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <ul className="board-issues mt-1 list-none text-sm">
      {issues.map((issue, i) => (
        <li
          key={i}
          className={issue.notice ? "text-amber-800" : "text-red-700"}
        >
          {issue.line === null ? "" : `${issue.line} 行目: `}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
