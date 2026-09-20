import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BoardDiagram } from "./BoardDiagram";

// 実体配線図はブラウザで描く (docs/97)。SSR では「描画中」だけを返し、
// 処理系 (gzip 50KB) を**サーバの束に引きずり込まない**こと。
// mermaid と同じ立て付けなので、試験も同じ形にしてある
test("SSR ではプレースホルダを表示し処理系を import しない", () => {
  const html = renderToStaticMarkup(
    <BoardDiagram lang="breadboard" code={"board: half\nparts:\n  R1: resistor a5 a10 330"} />,
  );
  expect(html).toContain("board-diagram");
  expect(html).toContain("図を描画中");
  expect(html).not.toContain("<svg");
});

test("perfboard も同じ", () => {
  const html = renderToStaticMarkup(
    <BoardDiagram lang="perfboard" code={"board: 28x18"} />,
  );
  expect(html).toContain("図を描画中");
});
