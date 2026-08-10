import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";

// エディタの構文解析が GFM であることを押さえる
// (docs/70-編集ライブプレビュー計画.md §5)。
//
// **既定の markdown() は CommonMark だけ**で、`- [ ] ` も `~~消し~~` も表も
// 構文木に出ない。本文の描画は remark-gfm で GFM として解釈している
// (markdownPipeline.tsx) ので、エディタ側だけ CommonMark だと食い違う。
//
// 食い違いは「装飾が付かない」形でしか表に出ないため気づきにくい —
// 実際、ライブプレビューのチェックボックスがウィジェットにならず、
// 実機で見て初めて判った。ここで構文木の中身として固定しておく。

// MemoEditorInner が組んでいるものと同じ設定
function nodeNames(doc: string): Set<string> {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
  const names = new Set<string>();
  syntaxTree(state).iterate({
    enter: (node) => {
      names.add(node.name);
    },
  });
  return names;
}

describe("エディタの markdown 解析", () => {
  test("チェックボックスを見分ける (ライブプレビューがウィジェットにする目印)", () => {
    expect(nodeNames("- [ ] 買い物")).toContain("TaskMarker");
  });

  test("済みのチェックボックスも見分ける", () => {
    expect(nodeNames("- [x] 買い物")).toContain("TaskMarker");
  });

  test("打消し線を見分ける", () => {
    expect(nodeNames("~~消した~~")).toContain("Strikethrough");
  });

  test("表を見分ける", () => {
    expect(nodeNames("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("Table");
  });

  test("CommonMark 既定では上がすべて出ない (これが直した中身)", () => {
    // 既定に戻したときに上の 4 つが黙って効かなくなることの裏取り。
    // 「GFM を渡している」ではなく「渡さないと出ない」を示す
    const state = EditorState.create({
      doc: "- [ ] 買い物\n~~消した~~",
      extensions: [markdown()],
    });
    const names = new Set<string>();
    syntaxTree(state).iterate({
      enter: (node) => {
        names.add(node.name);
      },
    });
    expect(names).not.toContain("TaskMarker");
    expect(names).not.toContain("Strikethrough");
  });
});
