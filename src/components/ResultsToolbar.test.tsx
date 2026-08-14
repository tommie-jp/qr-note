import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/viewMode";
import { ResultsToolbar } from "./ResultsToolbar";
import { SelectModeProvider } from "./SelectModeProvider";

// 検索結果の見出し行に並ぶ操作 (docs/86 §4-11)。もとは下部バーに居たので、
// 循環・読み上げ・フォーム送信の約束はそのまま引き継いでいる

const noop = () => {};

const render = (
  view: ViewMode = "compact",
  sort: Sort = "updated",
  query = "",
) =>
  renderToStaticMarkup(
    <SelectModeProvider>
      <ResultsToolbar
        query={query}
        sort={sort}
        view={view}
        viewAction={noop}
        sortAction={noop}
      />
    </SelectModeProvider>,
  );

test("表示・並び順・選択の 3 つを出す", () => {
  const html = render();
  for (const label of ["小", "更新順", "選択"]) {
    expect(html).toContain(label);
  }
});

// 表示は 小→大→画像 の循環トグル、並び順は 2 択のトグル。どちらも 1 スロットで
// ラベルには**現在の値**を出す (docs/31-下部操作バー計画.md §3-4、docs/32 §3)

test("表示トグルは現在のモードを見せ、送信値は次のモードになる", () => {
  const html = render("compact");
  // いま何が選ばれているかが押さなくても判る
  expect(html).toContain(">小<");
  // 押したら切り替わる先 (小 → 中 → 大 → 画像 の循環)
  expect(html).toContain('value="medium"');
  expect(html).not.toContain('value="compact"');
});

test("カード表示の次は画像表示", () => {
  const html = render("card");
  expect(html).toContain(">大<");
  expect(html).toContain('value="image"');
  expect(html).not.toContain('value="card"');
});

test("画像表示の次は小に戻る (循環の最後の辺)", () => {
  const html = render("image");
  expect(html).toContain(">画像<");
  expect(html).toContain('value="compact"');
  expect(html).not.toContain('value="image"');
  // 行き先も読み上げに乗せる (押す前に循環の次が判る)
  expect(html).toContain("表示: 画像 (押すと小に切替、長押しで一覧)");
});

// 並び順は 更新順 → アクセス順 → 番号順 → タイトル順 の 4 値循環
// (docs/37-アクセス順計画.md、docs/63-タイトル順計画.md)。表示モードと同じ形。
// **リンクではなくフォーム送信**にしてあるのは cookie に覚えるため
// (src/lib/sortMode.ts)。value は循環の次の並び
test("更新順の次はアクセス順", () => {
  const html = render("compact", "updated", "npn");
  expect(html).toContain(">更新順<");
  expect(html).toContain('value="accessed"');
  // 行き先も読み上げに乗せる (押す前に循環の次が判る)
  expect(html).toContain(
    "並び順: 更新順・新しい順 (押すとアクセス順に切替、長押しで一覧)",
  );
});

test("アクセス順の次は番号順", () => {
  const html = render("compact", "accessed");
  expect(html).toContain(">アクセス順<");
  expect(html).toContain('value="itemNo"');
  expect(html).toContain(
    "並び順: アクセス順・新しい順 (押すと番号順に切替、長押しで一覧)",
  );
});

test("番号順の次はタイトル順", () => {
  const html = render("compact", "itemNo");
  expect(html).toContain(">番号順<");
  expect(html).toContain('value="title"');
  expect(html).toContain(
    "並び順: 番号順・小さい順 (押すとタイトル順に切替、長押しで一覧)",
  );
});

test("タイトル順の次は既定の更新順に戻る (循環の最後の辺)", () => {
  const html = render("compact", "title");
  expect(html).toContain(">タイトル順<");
  expect(html).toContain('value="updated"');
  expect(html).toContain(
    "並び順: タイトル順・昇順 (押すと更新順に切替、長押しで一覧)",
  );
});

// 逆順 (docs/64-並び順逆順計画.md)。メニューは 4 行のままで、
// **選んである行をもう一度押したときだけ**方向が裏返る。
// バーのラベルは種別のまま (幅が増えない) で、方向はアイコンと読み上げに出す
test("逆順でも種別のラベルは変わらず、方向は読み上げに出る", () => {
  const html = render("compact", "updatedAsc");
  expect(html).toContain(">更新順<");
  expect(html).toContain(
    "並び順: 更新順・古い順 (押すとアクセス順に切替、長押しで一覧)",
  );
});

// 短いタップは今までどおり**種別だけ**を回す。方向はその種別の既定に戻す —
// 8 値を 1 スロットで循環させると一周が遠すぎるし、いま何順なのかも見失う
test("逆順から短いタップで回すと次の種別の既定の方向へ行く", () => {
  expect(render("compact", "updatedAsc")).toContain('value="accessed"');
  expect(render("compact", "itemNoDesc")).toContain('value="title"');
  expect(render("compact", "titleDesc")).toContain('value="updated"');
});

test("方向ごとに違うアイコンを出す (昇順と降順で描画が変わる)", () => {
  // 形そのもの (上向き / 下向きの矢印) はブラウザで確認する。ここで固定
  // できるのは「方向で描き分けている」ことだけ
  expect(render("compact", "accessed")).not.toBe(
    render("compact", "accessedAsc"),
  );
});

// リンクのままだと URL しか変わらず、?sort= を持たない入口から入るたびに
// 既定へ戻っていた。cookie を書けるのはフォーム送信だけ
test("並び順は cookie 名で送るフォームになっている", () => {
  const html = render();
  expect(html).toContain('name="sort"');
  expect(html).toContain('type="submit"');
});

test("並び順の切替は検索語を持ち回す", () => {
  // 並び替えただけで検索語が消えては困る。フォームなので hidden で運ぶ
  const html = render("compact", "updated", "npn");
  expect(html).toContain('name="q" value="npn"');
});

test("表示の切替は cookie を書くフォーム送信で、JS 無効でも動く", () => {
  const html = render();
  expect(html).toContain("<form");
  expect(html).toContain('type="submit"');
  expect(html).toContain('name="view"');
});

test("初期状態では選択モードに入っていない", () => {
  const html = render();
  expect(html).toContain('aria-pressed="false"');
});

// 長押しメニュー (docs/62-下部バー長押し計画.md)。
// 開いた後の描画は state なので静的描画では作れない (jsdom を持たない土台)。
// ここで固定できるのは「既定では閉じている」「開ける口が読み上げに出ている」
// の 2 つで、開閉そのものはブラウザで確認する
test("長押しメニューは既定では閉じている", () => {
  const html = render();
  // 開いていない = 選択肢が DOM に居ない。居ると JS 無効の環境で
  // 3 つの submit ボタンが常時見えてしまう
  expect(html).not.toContain('role="menu"');
  expect(html).toContain('aria-expanded="false"');
});

test("表示と並び順は長押しでメニューが開くことを読み上げに出す", () => {
  const html = render();
  // aria-haspopup が無いと、押したら値が変わるだけのボタンに見える
  expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2);
});
