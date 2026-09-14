import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BottomBarProvider } from "./BottomBarContext";
import { BottomBarShell, PageBottomBar } from "./PageBottomBar";

// 静的描画では useEffect が走らない = 差し込みの申告が無い状態にあたる。
// 帯の中身がある場合の見た目は BottomBarShell を直に描いて確かめる
const renderBar = (isProd: boolean) =>
  renderToStaticMarkup(
    <BottomBarProvider>
      <PageBottomBar isProd={isProd} />
    </BottomBarProvider>,
  );

const renderShell = (isProd: boolean) =>
  renderToStaticMarkup(<BottomBarShell isProd={isProd} hostRef={() => {}} />);

// ← → をヘッダーへ移した後、この帯に常設の中身は無い。編集していないページで
// 空の帯が居座らないこと (docs/11 §5-2)
test("差し込む側がいなければ帯も余白も描かない", () => {
  expect(renderBar(true)).toBe("");
});

// 帯は差し込み口 (portal 先) と、本文が隠れないための余白を持つ
test("帯は差し込み口と下端の余白を持つ", () => {
  const html = renderShell(true);
  expect(html).toContain("fixed");
  expect(html).toContain('aria-hidden="true"');
});

// 非本番は帯もピンクに塗る (ヘッダー・BottomActionBar と揃える)
test("非本番ではピンク枠にする", () => {
  expect(renderShell(false)).toContain("border-pink-300");
});

// 戻る/進むはヘッダーが持つ。下部バーに残していると二重に出る
test("戻る・進むは持たない (ヘッダーへ移した)", () => {
  const html = renderShell(true);
  expect(html).not.toContain("前の画面に戻る");
  expect(html).not.toContain("次の画面に進む");
});
