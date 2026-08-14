import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PaneModeButton } from "./PaneModeButton";

const noop = () => {};

const render = (mode: "3" | "2" | "1") =>
  renderToStaticMarkup(<PaneModeButton mode={mode} action={noop} />);

test("いまの構成を数字で見せ、押した先を value に持つ (3 → 2)", () => {
  const html = render("3");
  expect(html).toContain(">3<");
  expect(html).toContain('name="panes"');
  expect(html).toContain('value="2"');
});

test("1 の次は 3 に戻る (循環)", () => {
  const html = render("1");
  expect(html).toContain(">1<");
  expect(html).toContain('value="3"');
});

test("読み上げは今の構成、押した先は title に添える", () => {
  const html = render("2");
  expect(html).toContain('aria-label="2 ペイン (検索結果・ノート)"');
  expect(html).toContain("押すと 1 ペイン");
});

test("ペインの無いスマホでは出さない", () => {
  // ペインは lg 以上でしか出ないので、押しても何も変わらない
  expect(render("3")).toContain("hidden lg:block");
});
