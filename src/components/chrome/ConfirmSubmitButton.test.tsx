import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";

const noop = () => {};

test("送信ボタンとして描画する", () => {
  const html = renderToStaticMarkup(
    <ConfirmSubmitButton formAction={noop} confirmMessage="消す?">
      永久削除
    </ConfirmSubmitButton>,
  );
  expect(html).toContain("<button");
  expect(html).toContain('type="submit"');
  expect(html).toContain("永久削除");
});

test("渡された class を反映する", () => {
  const html = renderToStaticMarkup(
    <ConfirmSubmitButton formAction={noop} confirmMessage="消す?" className="text-red-700">
      永久削除
    </ConfirmSubmitButton>,
  );
  expect(html).toContain("text-red-700");
});
