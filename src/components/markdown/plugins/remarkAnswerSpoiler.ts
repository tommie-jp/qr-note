import type { Emphasis, Parent, Root, RootContent, Text } from "mdast";
import { hasChildren, splitTextNode } from "./splitTextNode";
import {
  ANSWER_CLOSED_MARK,
  ANSWER_SPOILER_CLASS,
  findAnswerSpoilers,
} from "@/lib/vocab/answerSpoiler";

// 本文中の `||答え||` を、押して開く印に変換する remark プラグイン
// (docs/79-答え隠し計画.md)。remarkTagLinks と同じく mdast の text ノードだけを
// 見るので、コード (code / inlineCode) の中は変換されない。
//
// 除外する入れ物が 2 つある:
//   tableCell … GFM の表では `||` が空セルを意味する (`| a || b |`)。
//               表の中で記法にすると、書いた表が黙って壊れる
//   link      … 開くのは <button> なので、リンクの中に置くと
//               <a> の中に <button> という不正な入れ子になる
//
// mask を渡すと、押せる印ではなく**ただの ▶** に置き換える。一覧のノート
// プレビュー (NotePreviewThumb) 用 — あちらは静的な絵で、client 部品を
// 置きたくない。かつ `||訳||` の文字がそのまま出ると答えが漏れる。

interface AnswerSpoilerOptions {
  mask?: boolean;
}

const SKIP_TYPES = new Set(["tableCell", "link"]);

// data.hName で出力する要素を span に差し替える。node の型としては emphasis を
// 借りているが (mdast の型に自作の種類を足さないため)、to-hast は hName を
// 優先するので <em> にはならない。remarkAlerts が blockquote に class を刻んで
// 部品を差し替えるのと同じ作法
function spoilerNode(answer: string): Emphasis {
  return {
    type: "emphasis",
    data: {
      hName: "span",
      hProperties: { className: [ANSWER_SPOILER_CLASS] },
    },
    children: [{ type: "text", value: answer }],
  };
}

function splitAnswers(node: Text, mask: boolean): RootContent[] {
  return splitTextNode(node, findAnswerSpoilers(node.value), ({ answer }) =>
    mask ? { type: "text", value: ANSWER_CLOSED_MARK } : spoilerNode(answer),
  );
}

function transform(node: Parent, mask: boolean): void {
  const next: RootContent[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      next.push(...splitAnswers(child, mask));
      continue;
    }
    if (hasChildren(child) && !SKIP_TYPES.has(child.type)) {
      transform(child, mask);
    }
    next.push(child);
  }
  node.children = next;
}

export function remarkAnswerSpoiler({ mask = false }: AnswerSpoilerOptions = {}) {
  return (tree: Root): void => {
    transform(tree, mask);
  };
}
