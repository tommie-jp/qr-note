import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import {
  IDLE_PANE_MODE,
  pendingPaneModeStore,
} from "@/lib/prefs/pendingPaneMode";
import { PaneModeButton } from "./PaneModeButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

afterEach(() => {
  pendingPaneModeStore.set(IDLE_PANE_MODE);
});

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

test("どの幅でも出す (構成から抜ける手段を残す)", () => {
  // 3 ペインは幅に関係なく 3 ペイン (docs/86 §4-9)。狭い画面でボタンを
  // 隠すと、選んだ構成から抜けられなくなる
  expect(render("3")).not.toContain("hidden lg:block");
});

// 押した直後は cookie (mode) より送った先を見せる (docs/86 §4-18)。
// サーバ描画では端末の状態を読まないので、ここは store の get で確かめる
test("送った先の構成は store に置かれ、サーバ描画は cookie の値のまま", () => {
  pendingPaneModeStore.set({ mode: "1", inflight: 1 });

  expect(render("2")).toContain(">2<");
  expect(pendingPaneModeStore.get().mode).toBe("1");
});
