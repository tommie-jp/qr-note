import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { OfflinePinToggle } from "./OfflinePinToggle";

const noop = () => {};

const render = (pinned: boolean, attachmentBytes = 0) =>
  renderToStaticMarkup(
    <OfflinePinToggle
      itemNo="1234"
      pinned={pinned}
      attachmentBytes={attachmentBytes}
      setPinAction={noop}
    />,
  );

// 公開トグルと同じく「望む状態」を送る。裏返す作りにすると二重送信で
// 意図と逆に倒れる (docs/65 §7)
test("印がないときは付ける側の値を送る", () => {
  expect(render(false)).toContain('name="pin" value="1"');
});

test("印があるときは外す側の値を送る", () => {
  expect(render(true)).toContain('name="pin" value="0"');
});

// 状態の差はアイコンと色だけになったので、読み上げにも状態を出す
test("aria-pressed が印の状態と一致する", () => {
  expect(render(true)).toContain('aria-pressed="true"');
  expect(render(false)).toContain('aria-pressed="false"');
});

// 押す前に量を出すのがこのトグルの役目 (docs/65 §7)。帯を畳んだので
// 置き場所は tooltip になった (docs/75 §3)
test("印がないときは落とす量を tooltip に出す", () => {
  const html = render(false, 12_900_000);
  expect(html).toContain("オフラインで使う");
  expect(html).toContain("12.3 MB");
});

test("添付がないノートでは量の括弧を出さない", () => {
  const html = render(false, 0);
  expect(html).toContain('title="オフラインで使う"');
});

test("印が付いているときは外す側の動作を tooltip に書く", () => {
  expect(render(true, 12_900_000)).toContain("保存をやめる");
});
