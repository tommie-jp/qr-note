import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ViewSwitchVeil } from "./ViewSwitchVeil";

test("押していなければ薄くせず、中身をそのまま描く", () => {
  const html = renderToStaticMarkup(
    <ViewSwitchVeil view="compact">
      <ul>一覧</ul>
    </ViewSwitchVeil>,
  );
  expect(html).toContain("<ul>一覧</ul>");
  expect(html).not.toContain("aria-busy");
  expect(html).not.toContain("opacity-50");
});
