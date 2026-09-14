import type { Link, Parent, Root, RootContent, Text } from "mdast";
import { findTags, tagSearchHref } from "@/lib/markdown/tags/tags";

// メモ本文中の #タグ を検索リンク (/?q=%23タグ名) に変換する remark プラグイン。
// mdast の text ノードだけを対象にするため、コード (code / inlineCode) や
// 既存リンクの中の # は変換されない (それらは text ノードではない、または
// link 配下として除外する)。見出しの # は Markdown 構文として消えるので無関係。

// 1 つの text ノードをタグ境界で text/link ノード列に分割する。
function splitTextNode(node: Text): RootContent[] {
  const matches = findTags(node.value);
  if (matches.length === 0) {
    return [node];
  }
  const out: RootContent[] = [];
  let pos = 0;
  for (const { start, length, raw, name } of matches) {
    if (start > pos) {
      out.push({ type: "text", value: node.value.slice(pos, start) });
    }
    const link: Link = {
      type: "link",
      url: tagSearchHref(name),
      children: [{ type: "text", value: raw }],
    };
    out.push(link);
    pos = start + length;
  }
  if (pos < node.value.length) {
    out.push({ type: "text", value: node.value.slice(pos) });
  }
  return out;
}

function hasChildren(node: unknown): node is Parent {
  return (
    typeof node === "object" &&
    node !== null &&
    Array.isArray((node as Parent).children)
  );
}

// insideLink 配下では入れ子リンクを避けるため変換しない。
function transform(node: Parent, insideLink: boolean): void {
  const next: RootContent[] = [];
  for (const child of node.children) {
    if (child.type === "text" && !insideLink) {
      next.push(...splitTextNode(child));
      continue;
    }
    if (hasChildren(child)) {
      transform(child, insideLink || child.type === "link");
    }
    next.push(child);
  }
  node.children = next;
}

export function remarkTagLinks() {
  return (tree: Root): void => {
    transform(tree, false);
  };
}
