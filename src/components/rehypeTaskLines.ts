import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

// タスクリストのチェックボックスに、元の Markdown の行番号を刻む rehype プラグイン
// (docs/55-チェックボックス操作計画.md §2)。
//
// `<input>` は mdast-util-to-hast が合成する要素なので position を持たないが、
// 親の `<li>` は持っている。押されたチェックボックスがどの行かを知るには、
// この行番号を input 側へ写しておくしかない。
//
// **rehype-sanitize の後に走らせること。** 前に置くと属性ごと落ちる。値は
// パーサ由来 (利用者の入力ではない) なので、スキーマを緩める必要はない。

// hast のプロパティ名。DOM では data-line 属性になり、react-markdown が
// components に渡す node から読める
export const TASK_LINE_PROPERTY = "dataLine";

const TASK_ITEM_CLASS = "task-list-item";

function hasTaskItemClass(node: Element): boolean {
  const className = node.properties?.className;
  return Array.isArray(className) && className.includes(TASK_ITEM_CLASS);
}

// li の子孫から最初のチェックボックスを探す。
// **直下の子だけでは足りない** — 項目の間に空行があるゆるいリストでは、
// input は <li> の直下ではなく <p> の中に入る。
// 入れ子のタスクリストがあっても、文書順で最初に見つかるのは必ず自分の
// チェックボックスなので、内側の項目のものを取ってしまうことはない。
function firstCheckbox(node: Element): Element | null {
  let found: Element | null = null;
  visit(node, "element", (child: Element) => {
    if (child.tagName === "input" && child.properties?.type === "checkbox") {
      found = child;
      return false; // 最初の 1 つで歩くのをやめる (EXIT)
    }
  });
  return found;
}

export function rehypeTaskLines() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "li" || !hasTaskItemClass(node)) {
        return;
      }
      const line = node.position?.start.line;
      if (line === undefined) {
        return;
      }
      const checkbox = firstCheckbox(node);
      if (checkbox?.properties) {
        checkbox.properties[TASK_LINE_PROPERTY] = line;
      }
    });
  };
}
