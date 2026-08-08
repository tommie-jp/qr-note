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
  expect(html).toContain("公開する");
});

test("公開中のときは非公開に戻す値を送る", () => {
  const html = render(new Date("2026-01-01T00:00:00Z"));
  expect(html).toContain('name="public" value="0"');
  expect(html).toContain("非公開にする");
});

// 非公開はこのアプリの既定の状態なので、説明を添えない (docs/62 §8)。
// ノートを開くたびに読まされる 1 行は、本文を下へ押しやるだけになる
test("非公開の表示は「非公開」だけにする", () => {
  const html = render(null);
  expect(html).toContain("非公開");
  expect(html).not.toContain("ログインした人だけ");
});

// 公開中の側に説明が残るのは、そこだけ事故ると取り返しがつかないから
// (見た人の手元からは消せない)
test("公開中は「誰でも見られる」ことを毎回言う", () => {
  const html = render(new Date("2026-01-01T00:00:00Z"));
  expect(html).toContain("公開中");
  expect(html).toContain("誰でも見られます");
});
