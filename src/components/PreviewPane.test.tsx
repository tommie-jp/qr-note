import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { PaneMode } from "@/lib/paneMode";
import { PaneModeProvider } from "./PaneModeProvider";
import { PreviewPane } from "./PreviewPane";

// 器の描画だけを見る (閉じる動作・Esc はブラウザ側で確認する)。
// pathname を差し替えて「URL が正」のゲートも確かめる
const nav = vi.hoisted(() => ({ pathname: "/item/4951" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ back: () => {} }),
}));

const render = (openHref?: string, mode: PaneMode = "2") =>
  renderToStaticMarkup(
    <PaneModeProvider mode={mode}>
      <PreviewPane bgClass="bg-gray-50" itemNo="4951" openHref={openHref}>
        <p>ノート本文</p>
      </PreviewPane>
    </PaneModeProvider>,
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
  // 出しっぱなしにしない構成 (1 ペイン) で確かめる
  nav.pathname = "/?q=BJT";
  try {
    expect(render("/item/4951", "1")).toBe("");
  } finally {
    nav.pathname = "/item/4951";
  }
});

test("/item の深い階層 (履歴など) でも描かない", () => {
  nav.pathname = "/item/4951/history";
  try {
    expect(render("/item/4951", "1")).toBe("");
  } finally {
    nav.pathname = "/item/4951";
  }
});

// ペイン構成 (docs/86 §4-4)

test("3 ペインでは /item の外でもノートを閉じない (幅でも畳まない)", () => {
  nav.pathname = "/?q=BJT";
  try {
    const html = render("/item/4951", "3");
    expect(html).toContain("ノート本文");
    // 押しても閉じられない物をボタンにしない
    expect(html).not.toContain("閉じる");
    expect(html).not.toContain("max-lg:hidden");
  } finally {
    nav.pathname = "/item/4951";
  }
});

test("2 ペインの「閉じる」は全画面になる幅でだけ出す", () => {
  // ペインとして常設されている間 (lg 以上) は押しても閉じられない
  const html = render("/item/4951", "2");
  expect(html).toContain("閉じる");
  expect(html).toContain("lg:hidden");
});

// 2 ペインもペインとして出ている間 (lg 以上) はノートを閉じない。
// 狭い画面ではノートが全画面になるので、そこだけ CSS で畳む
test("2 ペインは /item の外でもノートを残し、狭い画面でだけ畳む", () => {
  nav.pathname = "/?q=BJT";
  try {
    const html = render("/item/4951", "2");
    expect(html).toContain("ノート本文");
    expect(html).toContain("max-lg:hidden");
  } finally {
    nav.pathname = "/item/4951";
  }
});

test("1 ペインは /item の外では出さない", () => {
  nav.pathname = "/?q=BJT";
  try {
    expect(render("/item/4951", "1")).toBe("");
  } finally {
    nav.pathname = "/item/4951";
  }
});

test("1 ペインのノートは全画面 (下部ペインの寸法を持たない)", () => {
  const html = render("/item/4951", "1");
  expect(html).toContain("ノート本文");
  // 一覧の底を上げるフックも、下部ペインの高さも持たない
  expect(html).not.toContain("data-preview-pane");
  expect(html).not.toContain("--preview-pane-h");
  // ヘッダーは覆わない (§4-5)
  expect(html).toContain("top-[var(--header-h)]");
});

test("3 / 2 ペインのノートは下部ペイン (一覧の底を上げるフックを持つ)", () => {
  const html = render("/item/4951", "2");
  expect(html).toContain("data-preview-pane");
  expect(html).toContain("var(--preview-pane-h)");
});

// 3 ペインは幅に関係なく下部のペイン (docs/86 §4-9)。全画面にならないので、
// URL を離れても出し続けて画面を覆う心配がない
test("3 ペインのノートは幅に関係なく下部のペイン", () => {
  const html = render("/item/4951", "3");
  expect(html).toContain("bottom-[var(--bottom-bar-h)]");
  expect(html).toContain("h-[var(--preview-pane-h)]");
  expect(html).not.toContain("max-lg:hidden");
});

test("2 ペインのノートは lg 以上でだけペイン (狭い画面は全画面)", () => {
  const html = render("/item/4951", "2");
  expect(html).toContain("top-[var(--header-h)]");
  expect(html).toContain("lg:bottom-[var(--bottom-bar-h)]");
});
