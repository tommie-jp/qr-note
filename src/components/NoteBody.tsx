import { MarkdownView } from "@/components/MarkdownView";
import { RevealAllAnswers } from "@/components/answer/RevealAllAnswers";
import { NotePager } from "@/components/NotePager";
import { noteDefinitions, splitPages } from "@/components/notePages";
import type { ToggleTaskHandler } from "@/components/TaskCheckbox";
import { hasAnswerSpoiler } from "@/lib/answerSpoiler";
import type { CircuitMap } from "@/lib/circuitCache";
import type { HealthMap } from "@/lib/healthData";
import type { MatrixMap } from "@/lib/matrixData";

// ノート本文をページに分けて描く (docs/74-ページ計画.md §4)。
//
// **本文を出す 3 つの画面 (ItemView / PublicItemView / OfflineNote) は必ず
// ここを通す。** 片方だけページにすると、同じノートが公開リンクでは 1 枚
// 続きに見える。
//
// "use client" を付けないので、サーバ (ItemView) からもクライアント
// (OfflineNote) からも呼べる (MarkdownView と同じ立ち位置)。
//
// **行番号のずれをここ 1 か所で吸収する。** ページごとに描くと
// rehypeTaskLines の行番号がページの中で 1 に戻るため、開始行を足して
// 本文全体に対する番号に戻す (呼ぶ側に足し算を配らない)。
//
// **ページを跨ぐ定義 (脚注・参照リンク) もここで吸収する。** ページごとに
// パースするので、定義と参照が違うページに落ちると参照は生の `[^1]` の文字に、
// 定義のほうは何も描かれず注釈の文章がノートから消える (notePages.ts の
// noteDefinitions)。

interface NoteBodyProps {
  memo: string;
  circuits?: CircuitMap;
  matrices?: MatrixMap;
  health?: HealthMap;
  linkTags?: boolean;
  allowRotate?: boolean;
  allowSecretEdit?: boolean;
  onToggleTask?: ToggleTaskHandler;
}

// 定義は**ページの本文の後ろ**に足す。前に足すと、そのページの
// チェックボックスの行番号 (rehypeTaskLines) が定義の行数だけずれて、
// 押したときに本文の別の行が反転する。
//
// 空行を 1 つ挟むのは、本文が段落の途中で終わっているとき (区切りの直前に
// 空行が無い形) に、定義が段落の続きとして読まれてしまうため
function withDefinitions(body: string, definitions: string): string {
  return definitions === "" ? body : `${body}\n\n${definitions}\n`;
}

export function NoteBody({
  memo,
  circuits,
  matrices,
  health,
  linkTags,
  allowRotate,
  allowSecretEdit,
  onToggleTask,
}: NoteBodyProps) {
  const notePages = splitPages(memo);
  // 1 ページのノートは本文まるごとで、定義は元の場所に居る。配る必要が無いので
  // パースも省く (実データの大多数がこのノート)
  const definitions = notePages.length > 1 ? noteDefinitions(memo) : "";
  const pages = notePages.map((page) => ({
    name: page.name,
    content: (
      <MarkdownView
        markdown={withDefinitions(page.body, definitions)}
        circuits={circuits}
        matrices={matrices}
        health={health}
        linkTags={linkTags}
        allowRotate={allowRotate}
        allowSecretEdit={allowSecretEdit}
        onToggleTask={onToggleTask}
        lineOffset={page.line - 1}
      />
    ),
  }));

  // 答え隠し (docs/79) を持つノートだけ、まとめて開く口を添える。
  // 持たないノートに出すと、押しても何も起きないボタンが並ぶ
  if (hasAnswerSpoiler(memo)) {
    return (
      <RevealAllAnswers>
        <NotePager pages={pages} />
      </RevealAllAnswers>
    );
  }
  return <NotePager pages={pages} />;
}
