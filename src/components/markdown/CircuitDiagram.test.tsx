import { PassThrough } from "node:stream";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { CircuitDiagram } from "./CircuitDiagram";

const SVG = '<svg id="drawn"><path/></svg>';
const CODE = String.raw`\draw (0,0) to[R=$R_1$] (2,0);`;

// 本番と同じ流し込み (Suspense のストリーミング) で最後まで描き切らせる。
// renderToStaticMarkup は待てないので、後から届く図はこちらでしか見られない
function renderToHtml(element: React.ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on("data", (chunk: Buffer) => chunks.push(chunk));
    sink.on("end", () => resolve(Buffer.concat(chunks).toString()));
    sink.on("error", reject);

    const { pipe } = renderToPipeableStream(element, {
      onShellReady: () => pipe(sink),
      onError: reject,
    });
  });
}

// 描き上がるのを待たずに本文を出す作りの要 (docs/85-回路図表示待ち計画.md §3)。
// 未解決の約束を渡された図は「準備中」の場所取りになり、本文の他の部分を
// 止めないこと
test("描画中は準備中の場所取りを出す", () => {
  const pending = new Promise<never>(() => {});

  const html = renderToStaticMarkup(
    <CircuitDiagram result={pending} code={CODE} />,
  );

  expect(html).toContain("回路図を準備中");
  expect(html).not.toContain("<svg");
});

// オフラインの画面 (OfflineNote) は描画済みの SVG を同期で渡す。
// そちらが「準備中」を一瞬でも挟まないこと
test("描画済みの結果は待たずにそのまま描く", () => {
  const html = renderToStaticMarkup(
    <CircuitDiagram result={{ svg: SVG }} code={CODE} />,
  );

  expect(html).toContain('id="drawn"');
  expect(html).not.toContain("回路図を準備中");
});

// 場所取りで終わってはいけない。描き上がった図がストリームで後から届くこと
// (これが無いと図が永遠に「準備中」のまま)。
//
// **すぐ解ける図では「準備中」は出ない** — React は場所取りを流す前に
// 少しだけ待つので、キャッシュヒット (16ms) の図は最初から絵として届く
test("描き上がった図が後から流れてくる", async () => {
  const later = new Promise<{ svg: string }>((resolve) =>
    setTimeout(() => resolve({ svg: SVG }), 10),
  );

  const html = await renderToHtml(<CircuitDiagram result={later} code={CODE} />);

  expect(html).toContain('id="drawn"');
});

test("描画に失敗した図は理由と書いた中身を出す", () => {
  const html = renderToStaticMarkup(
    <CircuitDiagram
      result={{ error: "TeX error", texLog: "! Undefined control sequence." }}
      code={CODE}
    />,
  );

  expect(html).toContain("TeX error");
  expect(html).toContain("Undefined control sequence");
  expect(html).toContain("to[R=$R_1$]");
});
