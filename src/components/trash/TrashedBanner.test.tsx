import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TrashedBanner } from "./TrashedBanner";

const noop = () => {};

const render = (itemNo: string) =>
  renderToStaticMarkup(
    <TrashedBanner itemNo={itemNo} restoreAction={noop} />,
  );

// QR シールから開いたときにゴミ箱と分かるようにする (docs/12-ゴミ箱計画.md §5)。
// 部品が手元に出てくる動線があるので notFound にはしない
test("ゴミ箱にある旨と復元ボタンを出す", () => {
  const html = render("1234");
  expect(html).toContain("ゴミ箱");
  expect(html).toContain("復元");
  expect(html).toContain('value="1234"');
});

test("ゴミ箱の一覧への導線を出す", () => {
  const html = render("1234");
  expect(html).toContain('href="/trash"');
});
