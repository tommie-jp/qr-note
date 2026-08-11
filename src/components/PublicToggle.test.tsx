import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PublicToggle } from "./PublicToggle";

const noop = () => {};

const render = (publicAt: Date | null) =>
  renderToStaticMarkup(
    <PublicToggle itemNo="1234" publicAt={publicAt} setPublicAction={noop} />,
  );

// フォームが送るのは「望む状態」であって「裏返せ」ではない。二重送信や
// 戻るボタンで意図と逆に倒れないようにするため
test("非公開のときは公開する側の値を送る", () => {
  const html = render(null);
  expect(html).toContain('name="public" value="1"');
});

test("公開中のときは非公開に戻す値を送る", () => {
  const html = render(new Date("2026-01-01T00:00:00Z"));
  expect(html).toContain('name="public" value="0"');
});

// ボタンに書くのは**いまの状態**で、押した後の動作名ではない (docs/75 §2)。
// 見出し行に畳んだ 1 つのボタンが状態と操作を兼ねるので、「公開する」と
// 書くと「いま公開中」と読み違える
test("ラベルはいまの状態を書く", () => {
  expect(render(null)).toContain("非公開");
  expect(render(new Date("2026-01-01T00:00:00Z"))).toContain("公開中");
});

// 非公開はこのアプリの既定の状態なので、画面に説明を添えない (docs/62 §8)。
// 帯を畳んだ後は公開中の側も同じ — 説明は tooltip へ移した (docs/75 §3)
test("説明は画面に出さず tooltip に入れる", () => {
  const html = render(new Date("2026-01-01T00:00:00Z"));
  expect(html).toContain('title="この URL を知っていれば誰でも見られます"');
  // 文が本文の流れに残っていないこと (ボタンの中身は状態の 1 語だけ)
  expect(html).not.toContain(">この URL を知っていれば");
});

test("非公開の tooltip は誰が見られるかを書く", () => {
  expect(render(null)).toContain('title="ログインした人だけが見られます"');
});
