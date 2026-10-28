import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PerfTestMenuItem } from "./PerfTestMenuItem";

test("計測していなければ開始だけを出す", () => {
  const html = renderToStaticMarkup(<PerfTestMenuItem running={false} />);

  expect(html).toContain("計測テスト開始");
  expect(html).not.toContain("計測テスト終了");
});

test("計測中は 2 台目のために開始も出し、終了を並べる", () => {
  const html = renderToStaticMarkup(<PerfTestMenuItem running />);

  expect(html).toContain("計測テスト開始");
  expect(html).toContain("計測テスト終了");
});
