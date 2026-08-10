import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildAttachmentBlocks } from "./attachmentBlocks";

// 装飾の**組み立て**だけを見る (vitest は node 環境で DOM が無いため、
// widget の toDOM は呼ばれない)。位置と個数が合っていることを固定する。

function docState(text: string): EditorState {
  return EditorState.create({ doc: text, extensions: [markdown()] });
}

// 装飾の位置を配列で取り出す
function decorationPositions(text: string): number[] {
  const set = buildAttachmentBlocks(docState(text));
  const positions: number[] = [];
  const iter = set.iter();
  while (iter.value !== null) {
    positions.push(iter.from);
    iter.next();
  }
  return positions;
}

describe("buildAttachmentBlocks", () => {
  test("画像記法 1 つにつきチップを 1 つ出す", () => {
    expect(decorationPositions("![](/api/images/a.png)")).toHaveLength(1);
  });

  test("チップは記法のある行の末尾に置く (次の行ではなく)", () => {
    // Arrange: 2 行目に画像がある本文
    const doc = "見出し\n![](/api/images/a.png)\nあと書き";

    // Act
    const positions = decorationPositions(doc);

    // Assert: 2 行目の行末
    const secondLineEnd = "見出し\n![](/api/images/a.png)".length;
    expect(positions).toEqual([secondLineEnd]);
  });

  test("添付もシークレットも同じく 1 つずつ出す", () => {
    // 画像記法に相乗りしている全種別が対象。どれか 1 つでも漏れると、
    // ライブプレビューが記法を隠したあとに何も残らず「消えた」ように見える
    const doc = [
      "![](/api/images/a.png)",
      "![audio](/api/images/b.mp3)",
      "![video](/api/images/c.mp4)",
      "![仕様.pdf](/api/images/d.pdf)",
      "![メモ.md](/api/images/e.md)",
      "![銀行](/api/secrets/abcd1234)",
    ].join("\n");

    expect(decorationPositions(doc)).toHaveLength(6);
  });

  test("画像が無ければ何も出さない", () => {
    expect(decorationPositions("ただの本文\n# 見出し")).toHaveLength(0);
  });

  test("コードフェンスの中の画像記法は拾わない", () => {
    // 構文木に聞いているので、フェンスの中は Image ノードにならない
    const doc = "```text\n![](/api/images/a.png)\n```";
    expect(decorationPositions(doc)).toHaveLength(0);
  });

  test("同じ行に 2 つあれば 2 つ出す", () => {
    const doc = "![](/api/images/a.png) と ![](/api/images/b.png)";
    expect(decorationPositions(doc)).toHaveLength(2);
  });

  test("壊れた記法は黙って飛ばす (生のまま見せる)", () => {
    // 閉じ括弧が無い。無理に描くより、生記法のまま出したほうが直しやすい
    expect(decorationPositions("![](/api/images/a.png")).toHaveLength(0);
  });
});
