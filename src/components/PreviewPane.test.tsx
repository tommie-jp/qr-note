import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { PreviewPane } from "./PreviewPane";

// 器の描画だけを見る (閉じる動作・Esc はブラウザ側で確認する)。
// pathname を差し替えて「URL が正」のゲートも確かめる
const nav = vi.hoisted(() => ({ pathname: "/item/4951" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ back: () => {} }),
}));

const render = (openHref?: string) =>
  renderToStaticMarkup(
    <PreviewPane bgClass="bg-gray-50" openHref={openHref}>
      <p>ノート本文</p>
    </PreviewPane>,
  );

test("/item に居るときは器と中身を描く", () => {
  const html = render("/item/4951?q=BJT");
  // data-preview-pane は一覧の底上げ padding のフック (globals.css の
  // body:has)。名前を変えるときは globals.css と組で変えること
  expect(html).toContain("data-preview-pane");
  expect(html).toContain("ノート本文");
  expect(html).toContain("閉じる");
});

test("「全画面で開く」は Link ではなく素の <a> (横取りを抜けるハード遷移)", () => {
  const html = render("/item/4951?q=BJT");
  expect(html).toContain('<a href="/item/4951?q=BJT"');
  expect(html).toContain("全画面で開く");
});

test("openHref が無い間 (loading) は「全画面で開く」を出さない", () => {
  const html = render();
  expect(html).not.toContain("全画面で開く");
  expect(html).toContain("閉じる");
});

test("/item の外では何も描かない (ロゴや「一覧へ」で戻ったら消える)", () => {
  nav.pathname = "/?q=BJT";
  try {
    expect(render("/item/4951")).toBe("");
  } finally {
    nav.pathname = "/item/4951";
  }
});
