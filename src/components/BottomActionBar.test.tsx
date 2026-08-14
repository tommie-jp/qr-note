import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BottomActionBar } from "./BottomActionBar";

const render = (isProd = true) =>
  renderToStaticMarkup(
    <BottomActionBar stickerHost="qr.example.jp" isProd={isProd} />,
  );

// 表示・並び順・選択は検索結果の見出し行へ移した (docs/86 §4-11)。
// バーに残るのは一覧と無関係に押せる 2 つの入口だけ
test("スキャンと画像検索だけを出す", () => {
  const html = render();
  for (const label of ["スキャン", "画像検索"]) {
    expect(html).toContain(label);
  }
  for (const moved of ["更新順", "選択"]) {
    expect(html).not.toContain(moved);
  }
});

test("2 スロットのアイコンにそれぞれ機能色が乗る", () => {
  const html = render();
  for (const color of ["text-sky-600", "text-violet-600"]) {
    expect(html).toContain(color);
  }
});

// 非本番はヘッダーと同じくピンクに塗る。色に数日で慣れるとしても、
// 常時見えている帯が「本番ではない」ことに気づく手がかりになる
test("非本番はピンク、本番は白の帯にする", () => {
  expect(render(false)).toContain("bg-pink-100/95");
  expect(render(true)).toContain("bg-white/95");
});

// アイコン列は「押す物」だけの帯で、文字を持ち出す場所ではない
test("バーの文字は選択・コピーできない", () => {
  const html = render();
  expect(html).toContain("select-none");
  expect(html).toContain("[-webkit-touch-callout:none]");
});

test("一覧がバーに隠れないよう余白を確保する", () => {
  // これが無いと一覧の最終行とページ送りがバーの下に潜る
  const html = render();
  expect(html).toContain("env(safe-area-inset-bottom)");
});
