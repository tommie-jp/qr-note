import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ItemTags } from "./ItemTags";

const render = (tags: string[], linked?: boolean) =>
  renderToStaticMarkup(<ItemTags tags={tags} linked={linked} />);

test("タグが無ければ何も描かない", () => {
  // 空の <ul> でも gap の分だけ縦を食う。持たないなら置かない
  expect(render([])).toBe("");
});

test("タグはリンクになる", () => {
  const html = render(["抵抗"]);
  expect(html).toContain("#抵抗");
  expect(html).toContain("<a");
});

// 公開ビューではタグ検索が未ログインに閉じているので、押すと案内に化ける
// リンクは出さない
test("linked=false ならリンクにしない", () => {
  const html = render(["抵抗"], false);
  expect(html).toContain("#抵抗");
  expect(html).not.toContain("<a");
});

// タグを 10 個も付けたノートでは、折り返した帯が 3 行 4 行と縦に伸びて
// 本文を画面の下へ押し出していた (docs/62 §7)。1 行に固定して横へ送る
test("タグは折り返さず 1 行で横スクロールする", () => {
  const html = render(["抵抗", "コンデンサ", "ダイオード"]);
  expect(html).toContain("overflow-x-auto");
  // これが残っていると折り返してしまう
  expect(html).not.toContain("flex-wrap");
});

test("溢れたタグは縮めず横へ送る", () => {
  // shrink-0 が無いと flex の既定で縮み、タグ名が潰れて読めなくなる
  const html = render(["とても長いタグの名前", "もうひとつ"]);
  expect(html.match(/shrink-0/g)).toHaveLength(2);
});
