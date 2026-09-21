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

// 理由は複数行になりうる (TeX が落ちた理由 + 読めなかった行、YAML が
// 壊れていて指摘が 2 件以上)。改行を空白に潰されると 1 行に繋がって読めない
test("複数行の理由は改行のまま出す", () => {
  const html = renderToStaticMarkup(
    <CircuitDiagram
      result={{
        error: "TeX error\n3 行目: zz9 は番地の形ではありません",
        texLog: "",
      }}
      code={CODE}
    />,
  );

  expect(html).toContain("3 行目: zz9 は番地の形ではありません");
  expect(html).toContain("whitespace-pre-line");
});

// 読めない行があっても、組めた分があれば図は描ける (circuit-fence 0.8.0)。
// **図と一緒に、読めなかった行を出す** — 図が出ているぶん、何が図に
// 入っていないかは字で言わないと気づけない。
// お知らせ (思ったとおりに出ない) とは色で分け、直さないと図が変わらない
// 読めなかった行を先に置く
test("読めなかった行は図の下に、お知らせより先に出す", () => {
  const html = renderToStaticMarkup(
    <CircuitDiagram
      result={{
        svg: SVG,
        errors: [{ line: 3, message: "zz9 は番地の形ではありません" }],
        notices: [{ line: null, message: "grid-to は効きませんでした" }],
      }}
      code={CODE}
    />,
  );

  // 図は出る (エラーの箱に化けない)
  expect(html).toContain('id="drawn"');
  expect(html).toContain("3 行目: zz9 は番地の形ではありません");
  // 行が分からない指摘は行番号を付けずに出す
  expect(html).toContain("grid-to は効きませんでした");
  expect(html).not.toContain("null 行目");

  // 読めなかった行が先で、色が分かれている
  expect(html.indexOf("zz9")).toBeLessThan(html.indexOf("grid-to"));
  expect(html).toContain("text-red-700");
  expect(html).toContain("text-amber-800");
});
