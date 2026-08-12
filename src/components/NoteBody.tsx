import { MarkdownView } from "@/components/MarkdownView";
import { NotePager } from "@/components/NotePager";
import { splitPages } from "@/components/notePages";
import type { ToggleTaskHandler } from "@/components/TaskCheckbox";
import type { CircuitMap } from "@/lib/circuitCache";
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

interface NoteBodyProps {
  memo: string;
  circuits?: CircuitMap;
  matrices?: MatrixMap;
  linkTags?: boolean;
  allowRotate?: boolean;
  allowSecretEdit?: boolean;
  onToggleTask?: ToggleTaskHandler;
}

export function NoteBody({
  memo,
  circuits,
  matrices,
  linkTags,
  allowRotate,
  allowSecretEdit,
  onToggleTask,
}: NoteBodyProps) {
  const pages = splitPages(memo).map((page) => ({
    name: page.name,
    content: (
      <MarkdownView
        markdown={page.body}
        circuits={circuits}
        matrices={matrices}
        linkTags={linkTags}
        allowRotate={allowRotate}
        allowSecretEdit={allowSecretEdit}
        onToggleTask={onToggleTask}
        lineOffset={page.line - 1}
      />
    ),
  }));

  return <NotePager pages={pages} />;
}
