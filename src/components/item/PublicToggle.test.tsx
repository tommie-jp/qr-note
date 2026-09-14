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

// ボタンが出すのは**いまの状態**で、押した後の動作名ではない (docs/75 §2)。
// 1 つのボタンが状態と操作を兼ねるので、「公開する」と書くと「いま公開中」と
// 読み違える。文字を落とした後 (docs/82 §6) は、その状態を aria-label が言う
test("状態は aria-label に出す", () => {
  expect(render(null)).toContain('aria-label="非公開"');
  expect(render(new Date("2026-01-01T00:00:00Z"))).toContain(
    'aria-label="公開中"',
  );
});

// 見出し行の幅は本文の場所を削って作られている。既定の状態 (非公開) を
// 読み上げるためだけに文字幅を払わない (docs/82 §6)
test("ボタンの中身はアイコンだけ (文字を出さない)", () => {
  const html = render(null);
  expect(html).toContain("<svg");
  expect(html).not.toContain(">非公開<");
});

// 非公開はこのアプリの既定の状態なので、画面に説明を添えない (docs/62 §8)。
// 帯を畳んだ後は公開中の側も同じ — 説明は tooltip へ移した (docs/75 §3)。
// 文字を落としたぶん、tooltip は状態の名前から書き始める (docs/82 §6)
test("説明は画面に出さず tooltip に入れる", () => {
  const html = render(new Date("2026-01-01T00:00:00Z"));
  expect(html).toContain(
    'title="公開中 — この URL を知っていれば誰でも見られます"',
  );
  // 文が本文の流れに残っていないこと
  expect(html).not.toContain(">この URL を知っていれば");
});

test("非公開の tooltip は誰が見られるかを書く", () => {
  expect(render(null)).toContain(
    'title="非公開 — ログインした人だけが見られます"',
  );
});
