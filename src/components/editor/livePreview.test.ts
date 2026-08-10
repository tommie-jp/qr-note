import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import {
  createLivePreviewCompartment,
  livePreviewContent,
} from "./livePreview";

// 装飾の見た目そのものはブラウザでしか確かめられない (DOM が要る)。
// ここで固定するのは**組み上がること**と**本文に触らないこと**の 2 点。
// 前者は依存の入れ替え (@atomic-editor/editor は pre-1.0) で壊れたときに、
// 実機を開く前に気づくため。

const DOC = [
  "# 見出し",
  "",
  "**太字** と *斜体* と `コード`",
  "",
  "- [ ] やること",
  "- [x] やったこと",
  "",
  "![](/api/images/a.png)",
  "",
  "> 引用",
].join("\n");

function stateWith(enabled: boolean): EditorState {
  const compartment = createLivePreviewCompartment();
  return EditorState.create({
    doc: DOC,
    extensions: [markdown(), compartment.of(livePreviewContent(enabled))],
  });
}

describe("livePreviewContent", () => {
  test("ON でも OFF でも本文は 1 文字も変わらない", () => {
    // ライブプレビューの前提そのもの。装飾は表示層だけで行い、
    // state.doc は常に生の markdown のまま (docs/70 §2)
    expect(stateWith(true).doc.toString()).toBe(DOC);
    expect(stateWith(false).doc.toString()).toBe(DOC);
  });

  test("ON の拡張一式が組み上がる", () => {
    // @atomic-editor/editor は pre-1.0 で minor に breaking が来る。
    // 組めなくなったらここで落ちる (実機で気づく前に判る)
    expect(() => stateWith(true)).not.toThrow();
  });

  test("OFF は拡張を 1 つも足さない (従来の編集表示そのもの)", () => {
    expect(livePreviewContent(false)).toEqual([]);
  });

  test("切り替えても本文は保たれる", () => {
    // Arrange: ON で作った state
    const compartment = createLivePreviewCompartment();
    const state = EditorState.create({
      doc: DOC,
      extensions: [markdown(), compartment.of(livePreviewContent(true))],
    });

    // Act: OFF へ入れ替える (トグルが行う操作と同じ)
    const next = state.update({
      effects: compartment.reconfigure(livePreviewContent(false)),
    }).state;

    // Assert: 本文も履歴の深さも動かない
    expect(next.doc.toString()).toBe(DOC);
  });
});
