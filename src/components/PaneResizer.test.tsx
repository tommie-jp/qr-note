import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PANE_SIZES } from "@/lib/paneSize";
import { PaneResizer } from "./PaneResizer";

// 器の描画だけを見る (ドラッグ・キー操作はブラウザで確認する)。
// ここで確かめたいのは「掴める物として読み上げられるか」と
// 「境界の位置が CSS 変数に乗っているか」の 2 つ

test("動かせる境界として読み上げられる (window splitter)", () => {
  const html = renderToStaticMarkup(<PaneResizer kind="folder" />);
  expect(html).toContain('role="separator"');
  expect(html).toContain('aria-orientation="vertical"');
  expect(html).toContain(`aria-valuenow="${PANE_SIZES.folder.default}"`);
  expect(html).toContain(`aria-valuemin="${PANE_SIZES.folder.min}"`);
  expect(html).toContain(`aria-valuemax="${PANE_SIZES.folder.max}"`);
  // キーボードでも掴める
  expect(html).toContain('tabindex="0"');
  expect(html).toContain(PANE_SIZES.folder.label);
});

test("フォルダーの境界はペインの幅の変数に貼り付く (xl 以上だけ)", () => {
  const html = renderToStaticMarkup(<PaneResizer kind="folder" />);
  expect(html).toContain("left-[var(--folder-pane-w)]");
  expect(html).toContain("xl:block");
  expect(html).toContain("cursor-col-resize");
  // 指でなぞって画面ごとスクロールさせない
  expect(html).toContain("touch-none");
});

test("プレビューの境界は下部バーとペインの高さの和に貼り付く (lg 以上だけ)", () => {
  const html = renderToStaticMarkup(<PaneResizer kind="preview" />);
  expect(html).toContain(
    "bottom-[calc(var(--bottom-bar-h)+var(--preview-pane-h))]",
  );
  expect(html).toContain("lg:block");
  expect(html).toContain("cursor-row-resize");
  expect(html).toContain('aria-orientation="horizontal"');
});

test("サーバ描画は既定の寸法から始める (保存値はマウント後に読む)", () => {
  // 実際の寸法は <head> の先回りスクリプトが当てているので、ここが
  // 既定でも見た目は跳ねない。hydration の食い違いを作らないための約束
  const html = renderToStaticMarkup(<PaneResizer kind="preview" />);
  expect(html).toContain(`aria-valuenow="${PANE_SIZES.preview.default}"`);
});
