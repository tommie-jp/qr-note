import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { NoteBody } from "./NoteBody";

// 画像 (ZoomableImage) が回転確定後の router.refresh() のために useRouter を
// 呼ぶ。renderToStaticMarkup には App Router のコンテキストが無く useRouter が
// 投げるので、ここだけ差し替える (MarkdownView.test.tsx と同じ)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const render = (memo: string) =>
  renderToStaticMarkup(<NoteBody memo={memo} />);

// ページは別々にパースされるので、定義 (脚注 `[^1]:` / 参照リンク `[x]:`) と
// 参照が違うページに落ちると**両方が壊れる** — 参照は生の `[^1]` の文字に、
// 定義のほうは何も描かれず注釈の文章がノートから消える。`---` の下に脚注を
// まとめて書くのはごく普通の形なので、定義を全ページに配る (docs/74 §4)
test("ページを跨いだ脚注が参照も注釈も出る", () => {
  const html = render("本文[^1] つづき\n\n---\n\n2ページ目\n\n[^1]: 注釈です\n");
  expect(html).toContain('href="#user-content-fn-1"');
  expect(html).toContain('<li id="user-content-fn-1">');
  expect(html).toContain("注釈です");
  // 生の記法が文字のまま残らない (参照も定義も Markdown として読まれた)
  expect(html).not.toContain("[^1]");
});

test("ページを跨いだ参照リンクが繋がる", () => {
  // 1 行目を参照にしないのは、帯に出るページ名 (memoSummary) が参照記法を
  // 剥がさないため。見たいのは本文の描画のほう
  const html = render(
    "出典\n\n[サイト][x] を見る\n\n---\n\n2ページ目\n\n[x]: https://example.com\n",
  );
  expect(html).toContain('href="https://example.com"');
  expect(html).not.toContain("[サイト][x]");
});

// 配っても増えないことの裏取り。remark は参照されていない定義を捨てるので、
// 脚注の一覧が出るのは実際に使ったページだけ
test("使っていないページには脚注の枠を出さない", () => {
  const html = render("本文[^1] つづき\n\n---\n\n2ページ目\n\n[^1]: 注釈です\n");
  expect(html.match(/data-footnotes/g)).toHaveLength(1);
});

// 定義は本文の**後ろ**に足す。前に足すとそのページのチェックボックスの
// 行番号がずれ、押したときに本文の別の行が反転する (docs/74 §4)
test("定義を配ってもチェックボックスの行番号は動かない", () => {
  const html = render("本文[^1]\n\n---\n\n- [ ] やること\n\n[^1]: 注釈です\n");
  expect(html).toContain('data-line="5"');
});

test("区切りの無いノートの脚注は今までどおり", () => {
  const html = render("本文[^1]\n\n[^1]: 注釈です\n");
  expect(html).toContain('<li id="user-content-fn-1">');
  // 1 ページのノートはページ送りの帯ごと出さない
  expect(html).not.toContain("1 / 1");
});
