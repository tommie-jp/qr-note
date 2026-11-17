import type { Parent, RootContent, Text } from "mdast";

// text ノードを書き換える remark プラグイン (remarkTagLinks・remarkAnswerSpoiler)
// が共有する小道具。

// 文字の中の範囲 (先頭位置と長さ)
interface TextMatch {
  start: number;
  length: number;
}

// 1 つの text ノードを、見つかった範囲ごとに replace のノードへ差し替えて割る。
// 範囲の外の文字は text ノードのまま残す。範囲が無ければ元のノードを返す
export function splitTextNode<M extends TextMatch>(
  node: Text,
  matches: readonly M[],
  replace: (match: M) => RootContent,
): RootContent[] {
  if (matches.length === 0) {
    return [node];
  }
  const out: RootContent[] = [];
  let pos = 0;
  for (const match of matches) {
    if (match.start > pos) {
      out.push({ type: "text", value: node.value.slice(pos, match.start) });
    }
    out.push(replace(match));
    pos = match.start + match.length;
  }
  if (pos < node.value.length) {
    out.push({ type: "text", value: node.value.slice(pos) });
  }
  return out;
}

export function hasChildren(node: unknown): node is Parent {
  return (
    typeof node === "object" &&
    node !== null &&
    Array.isArray((node as Parent).children)
  );
}
