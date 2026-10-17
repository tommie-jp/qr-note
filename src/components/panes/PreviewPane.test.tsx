import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { PaneMode } from "@/lib/prefs/paneMode";
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
      <PreviewPane bgClass="bg-gray-50" itemId="4951" openHref={openHref}>
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
});

test("「全画面で開く」は Link ではなく素の <a> (横取りを抜けるハード遷移)", () => {
  const html = render("/item/4951?q=BJT");
  expect(html).toContain('<a href="/item/4951?q=BJT"');
  expect(html).toContain("全画面で開く");
});

test("openHref が無い間 (loading) は「全画面で開く」を出さない", () => {
  const html = render(undefined, "1");
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

// 2 ペインも幅に関係なく下部のペイン (docs/86 §4-16)。狭い画面でも
// 常設なので、押しても閉じられない「閉じる」は出さない
test("2 ペインは「閉じる」を出さない (幅に関係なく常設のペイン)", () => {
  const html = render("/item/4951", "2");
  expect(html).not.toContain("閉じる");
  expect(html).not.toContain("lg:hidden");
});

test("1 ペインのノートには「閉じる」を出す (全画面 = 閉じられる)", () => {
  expect(render("/item/4951", "1")).toContain("閉じる");
});

test("2 ペインは /item の外でもノートを残す (幅でも畳まない)", () => {
  nav.pathname = "/?q=BJT";
  try {
    const html = render("/item/4951", "2");
    expect(html).toContain("ノート本文");
    expect(html).not.toContain("max-lg:hidden");
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

// スマホでも検索結果とノートを 1 画面に並べる (docs/86 §4-16)。以前は
// lg 未満で全画面になり、一覧とノートを同時に見られなかった
test("2 ペインのノートも幅に関係なく下部のペイン", () => {
  const html = render("/item/4951", "2");
  expect(html).toContain("bottom-[var(--bottom-bar-h)]");
  expect(html).toContain("h-[var(--preview-pane-h)]");
  expect(html).not.toContain("top-[var(--header-h)]");
  expect(html).not.toContain("lg:bottom-");
});

// 器の上端はヘッダーの下か画面の下半分。standalone の iPhone で
// safe-area (47〜59px) を足すと、操作行の上に同じ幅の空白が挟まる
test("操作行はステータスバーぶんの余白を持たない", () => {
  for (const mode of ["3", "2", "1"] as const) {
    expect(render("/item/4951", mode)).not.toContain("pt-safe");
  }
});

// fixed のペインは親の余白ユーティリティに位置をずらされる (docs/86 §4-12)。
// 自動で選ぶノートは検索結果の器 (space-y-2) の子なので、実機では 8px 上へ
// 浮いて一覧の最下部に重なっていた
test("親の余白を打ち消す (fixed の位置が margin でずれないように)", () => {
  expect(render("/item/4951", "3")).toContain("m-0");
});

// 器の中では引っ張って更新を始めない (PullToRefresh が見る目印)。
// 短いノートは器がスクロールしないので、スクローラの有無では見分けられない
test("器は構成に関係なく「ノートの器」の目印を持つ", () => {
  for (const mode of ["3", "2", "1"] as const) {
    expect(render("/item/4951", mode)).toContain("data-note-pane");
  }
});

// 下部ペインでは、畳む形のとき上端の行を本文の上に浮かせる (docs/108 §3-6)。
// 左端の「閉じる」が無く、行の左半分が空のまま 48px を食っていた。
// サーバ描画は畳む形 (既定) なので、下部ペインは最初から浮いた形で出る
test("下部ペインの操作行は本文の上に浮く (高さを本文に貸す)", () => {
  for (const mode of ["3", "2"] as const) {
    const html = render("/item/4951", mode);
    expect(html).toContain("data-note-chrome-floating");
    // 行の根は本文を引き上げ、空いた左側で本文を塞がない
    expect(html).toMatch(
      /data-note-chrome-bar=""[^>]*class="[^"]*-mb-12[^"]*pointer-events-none/,
    );
    // 本文の先頭に札ぶんの詰め物 (最初の数行が札を避けて折り返す)
    expect(html).toMatch(/data-note-chrome-spacer=""[^>]*float-right/);
  }
});

test("全画面 (1 ペイン) の操作行も浮かせる (閉じる・全画面で開くの両方が札)", () => {
  const html = render("/item/4951", "1");
  expect(html).toContain("data-note-chrome-floating");
  expect(html).toMatch(/data-note-chrome-spacer=""[^>]*float-right/);
  // 「閉じる」は右の札に合流する (左の札は無い)
  expect(html).not.toContain("float-left");
  expect(html.indexOf("全画面で開く")).toBeLessThan(html.indexOf("閉じる"));
});

test("本文の頭に 1/4em の余白を持つ", () => {
  expect(render("/item/4951", "2")).toContain("pt-[0.25em]");
});

// 札を小さく保つため、下部ペインの「全画面で開く」は絵だけ。名前は aria-label
// (と長押しの吹き出し) が言う。全画面は場所があるので文字のまま
test("下部ペインの「全画面で開く」は絵だけ、全画面は文字", () => {
  const pane = render("/item/4951?q=BJT", "2");
  expect(pane).toMatch(
    /<a href="\/item\/4951\?q=BJT" aria-label="全画面で開く"[^>]*>\s*<svg/,
  );
  const full = render("/item/4951?q=BJT", "1");
  expect(full).toContain(">全画面で開く</a>");
  expect(full).not.toContain('aria-label="全画面で開く"');
});
