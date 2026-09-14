import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MermaidDiagram } from "./MermaidDiagram";

// mermaid はブラウザ専用のため、SSR では「描画中」プレースホルダを返すこと
// (クライアントの useEffect で初めて描画される) を保証する
test("SSR ではプレースホルダを表示し mermaid を import しない", () => {
  const html = renderToStaticMarkup(<MermaidDiagram code="graph TD; A-->B;" />);
  expect(html).toContain("mermaid-diagram");
  expect(html).toContain("図を描画中");
  expect(html).not.toContain("<svg");
});
