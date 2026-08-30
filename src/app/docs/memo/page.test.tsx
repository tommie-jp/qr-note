import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import MemoDocsPage from "./page";

test("docs/メモ記法.md の内容をレンダリングする", async () => {
  const html = renderToStaticMarkup(await MemoDocsPage());
  expect(html).toContain("メモ記法");
  expect(html).toContain("幅指定");
  expect(html).toContain("mermaid");
});

test("mermaid の記法例はコードブロックのまま図にしない", async () => {
  const html = renderToStaticMarkup(await MemoDocsPage());
  expect(html).not.toContain("mermaid-diagram");
});

test("circuit フェンス (YAML) の書き方を載せている", async () => {
  const html = renderToStaticMarkup(await MemoDocsPage());
  expect(html).toContain("circuit");
  expect(html).toContain("番地");
  expect(html).toContain("resistor");
});

// 目次と見出しの対応を**両向き**に見る。片側だけだと、よくある壊れ方の
// 片方を見逃す — リンク先だけ見ると節を足して目次に書き忘れたのが通り、
// 目次だけ見ると見出しを改名して静かに飛ばなくなったのが通る。
//
// **href は %エンコード、id は生の日本語**で出る (react-markdown の
// urlTransform が URL を正規化し、rehype-slug は見出しの文字をそのまま使う)。
// 食い違って見えるが、ブラウザは飛び先を探す前に fragment を percent-decode
// するので繋がる — GitHub の README の目次と同じ形。ここでも decode して比べる
test("目次と h2 見出しが過不足なく対応する", async () => {
  const html = renderToStaticMarkup(await MemoDocsPage());

  // 目次そのものの見出しは飛び先にならないので数えない
  const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id) => id !== "目次");
  expect(ids.length).toBeGreaterThan(0);

  const targets = [...html.matchAll(/<a[^>]+href="#([^"]+)"/g)].map((m) =>
    decodeURIComponent(m[1]),
  );

  // 飛ばないリンク (見出しを改名した / 目次の綴りを間違えた)
  expect(targets.filter((t) => !ids.includes(t))).toEqual([]);
  // 目次に無い節 (節を足して目次に書き忘れた)
  expect(ids.filter((id) => !targets.includes(id))).toEqual([]);
});
