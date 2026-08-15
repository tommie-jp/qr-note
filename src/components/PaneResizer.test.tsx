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

test("フォルダーの境界はペインの幅の変数に貼り付く (幅では畳まない)", () => {
  const html = renderToStaticMarkup(<PaneResizer kind="folder" />);
  expect(html).toContain("left-[var(--folder-pane-w)]");
  // フォルダーは 3 ペインのときしか描かれないので、幅で隠す必要がない
  expect(html).not.toContain("xl:block");
  expect(html).toContain("cursor-col-resize");
  // 指でなぞって画面ごとスクロールさせない
  expect(html).toContain("touch-none");
});

test("プレビューの境界は下部バーとペインの高さの和に貼り付く", () => {
  const html = renderToStaticMarkup(<PaneResizer kind="preview" />);
  expect(html).toContain(
    "bottom-[calc(var(--bottom-bar-h)+var(--preview-pane-h))]",
  );
  expect(html).toContain("cursor-row-resize");
  expect(html).toContain('aria-orientation="horizontal"');
});

// 2 ペイン (lg 以上だけペイン) では境界も幅で畳む
test("幅で畳む指定を受けたら lg 未満では出さない", () => {
  const html = renderToStaticMarkup(
    <PaneResizer kind="preview" atAnyWidth={false} />,
  );
  expect(html).toContain("hidden lg:block");
});

test("サーバ描画は既定の寸法から始める (保存値はマウント後に読む)", () => {
  // 実際の寸法は <head> の先回りスクリプトが当てているので、ここが
  // 既定でも見た目は跳ねない。hydration の食い違いを作らないための約束
  const html = renderToStaticMarkup(<PaneResizer kind="preview" />);
  expect(html).toContain(`aria-valuenow="${PANE_SIZES.preview.default}"`);
});

// 境界は掴む前から見えていること (docs/86 §4-10)。継ぎ目が判らないと、
// どこを掴めば動かせるのかも判らない
test("境界には濃いめのグレイの線を常に描く", () => {
  for (const kind of ["folder", "preview"] as const) {
    const html = renderToStaticMarkup(<PaneResizer kind={kind} />);
    expect(html).toContain("bg-gray-400");
    // 掴んでいる間は青 (どの境界を動かしているか判る)
    expect(html).toContain("group-active:bg-blue-600");
  }
});

test("掴む帯そのものは塗らない (太い色帯にしない)", () => {
  const html = renderToStaticMarkup(<PaneResizer kind="folder" />);
  expect(html).toContain("bg-transparent");
});

test("境界の帯も親の余白を打ち消す (docs/86 §4-12)", () => {
  for (const kind of ["folder", "preview"] as const) {
    expect(renderToStaticMarkup(<PaneResizer kind={kind} />)).toContain("m-0");
  }
});
