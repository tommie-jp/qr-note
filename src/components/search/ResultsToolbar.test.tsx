import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Sort } from "@/lib/validation";
import type { ViewMode } from "@/lib/prefs/viewMode";
import { ResultsToolbar } from "./ResultsToolbar";
import { SelectModeProvider } from "./SelectModeProvider";

// 表示モードの切替は router.refresh() で材料を埋める (docs/118 §10 案 B)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

// 検索結果の見出し行に並ぶ操作 (docs/86 §4-11)。もとは下部バーに居たので、
// 循環・読み上げ・フォーム送信の約束はそのまま引き継いでいる

const noop = () => {};

const render = (
  view: ViewMode = "compact",
  sort: Sort = "updated",
  query = "",
  trashCount = 0,
) =>
  renderToStaticMarkup(
    <SelectModeProvider>
      <ResultsToolbar
        query={query}
        sort={sort}
        view={view}
        viewAction={noop}
        sortAction={noop}
        trashCount={trashCount}
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

// 並び順は 更新順 → アクセス順 → 登録順 → タイトル順 の 4 値循環
// (docs/37-アクセス順計画.md、docs/63-タイトル順計画.md)。表示モードと同じ形。
// **リンクではなくフォーム送信**にしてあるのは cookie に覚えるため
// (src/lib/prefs/sortMode.ts)。value は循環の次の並び
test("更新順の次はアクセス順", () => {
  const html = render("compact", "updated", "npn");
  expect(html).toContain(">更新順<");
  expect(html).toContain('value="accessed"');
  // 行き先も読み上げに乗せる (押す前に循環の次が判る)
  expect(html).toContain(
    "並び順: 更新順・新しい順 (押すとアクセス順に切替、長押しで一覧)",
  );
});

// 向きは保つ (docs/64 追記 案 B)。アクセス順の新しい順の次は、登録順の新しい順
test("アクセス順の次は登録順 (向きを保つ)", () => {
  const html = render("compact", "accessed");
  expect(html).toContain(">アクセス順<");
  expect(html).toContain('value="registeredDesc"');
  expect(html).toContain(
    "並び順: アクセス順・新しい順 (押すと登録順に切替、長押しで一覧)",
  );
});

test("登録順の次はタイトル順", () => {
  const html = render("compact", "registered");
  expect(html).toContain(">登録順<");
  expect(html).toContain('value="title"');
  expect(html).toContain(
    "並び順: 登録順・古い順 (押すとタイトル順に切替、長押しで一覧)",
  );
});

test("タイトル順の次は更新順に戻る (循環の最後の辺。昇順を保つ)", () => {
  const html = render("compact", "title");
  expect(html).toContain(">タイトル順<");
  expect(html).toContain('value="updatedAsc"');
  expect(html).toContain(
    "並び順: タイトル順・昇順 (押すと更新順に切替、長押しで一覧)",
  );
});

// 逆順 (docs/64)。種別の釦のラベルは種別のまま (幅が増えない) で、
// 向きは隣の向きの釦と読み上げに出す
test("逆順でも種別のラベルは変わらず、方向は読み上げに出る", () => {
  const html = render("compact", "updatedAsc");
  expect(html).toContain(">更新順<");
  expect(html).toContain(
    "並び順: 更新順・古い順 (押すとアクセス順に切替、長押しで一覧)",
  );
});

// 短いタップは種別だけを回し、**向きは保つ** (docs/64 追記 案 B)。
// 押す前に見えている矢印が、押した後の並びの向きのまま
test("逆順から短いタップで回すと次の種別の同じ向きへ行く", () => {
  // 昇順 (古い順) の更新順 → 昇順のアクセス順
  expect(render("compact", "updatedAsc")).toContain('value="accessedAsc"');
  // 降順 (新しい順) の登録順 → 降順のタイトル順
  expect(render("compact", "registeredDesc")).toContain('value="titleDesc"');
  // 降順のタイトル順 → 降順 (既定) の更新順
  expect(render("compact", "titleDesc")).toContain('value="updated"');
});

// 向きの釦 (docs/64 追記 2026-11-17)。押すと種別はそのままで向きだけ裏返す
test("向きの釦は同じ種別の逆向きを送る", () => {
  expect(render("compact", "updated")).toContain('value="updatedAsc"');
  expect(render("compact", "updatedAsc")).toContain('value="updated"');
  expect(render("compact", "registered")).toContain('value="registeredDesc"');
  expect(render("compact", "titleDesc")).toContain('value="title"');
});

test("向きの釦は今の向きと押した先を読み上げに出す", () => {
  expect(render("compact", "updated")).toContain(
    'aria-label="並び順の向き: 新しい順 (押すと古い順に切替)"',
  );
  expect(render("compact", "title")).toContain(
    'aria-label="並び順の向き: 昇順 (押すと降順に切替)"',
  );
});

test("向きごとに違うアイコンを出す (昇順と降順で描画が変わる)", () => {
  // 形そのもの (上向き / 下向きの矢印) はブラウザで確認する。ここで固定
  // できるのは「方向で描き分けている」ことだけ
  expect(render("compact", "accessed")).not.toBe(
    render("compact", "accessedAsc"),
  );
});

// 種別の釦と向きの釦は同じ form の中 (送信中に両方が送った先を先に見せる)
test("向きの釦は種別の釦と同じ form にある", () => {
  const html = render();
  const sortForm =
    html.split("<form").find((part) => part.includes('name="sort"')) ?? "";
  expect(sortForm.match(/name="sort"/g)).toHaveLength(2);
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

// 見出し行を 1 行に保つ (docs/86 §4-14)。
//
// ここで固定できるのは「折り返さない指定と、削るための入れ物があるか」まで。
// 実際に何文字出るかは container query が決めるので、静的描画では測れない
// (ブラウザで実測済み: 器 260px で「ア」、512px で「アクセス順」)。

test("スロットは折り返さず縮まない", () => {
  const html = render();
  // whitespace-nowrap が無いと「タイトル順」がスロットの中で 2 行になり、
  // その行だけ背が高くなって見出し行が割れる (これが直したかった不具合)
  expect(html).toContain("whitespace-nowrap");
  // shrink-0 が無いと、詰まったときに件数ではなくスロットが潰れる
  expect(html).toContain("shrink-0");
});

test("ラベルは削れるよう span で包み、幅の上限を段で持つ", () => {
  const html = render();
  // 裸のテキストのままでは max-width を当てる相手がいない。
  // 4 つ (カレンダー・表示・並び順・選択) すべてに要る
  expect(html.match(/max-w-\[1em\]/g)).toHaveLength(4);
  // 段は container query。画面幅 (sm: など) で切ると、フォルダーペインを
  // 広げて一覧を細くしたときに効かない
  expect(html).toContain("@xs:max-w-[2em]");
  expect(html).toContain("@lg:max-w-none");
});

test("ラベルを削っても読み上げは完全なまま", () => {
  const html = render();
  // 見えている文字は 1 文字まで減りうるので、意味は aria-label が持つ。
  // 「並び順: 更新順・新しい順 (押すと…)」のような完全な説明
  expect(html).toContain('aria-label="並び順:');
  expect(html).toContain('aria-label="表示:');
});

// 帯の並び (docs/86 §4-33)。出たり消えたりするゴミ箱は末尾寄り
test("帯は ? / カレンダー / 表示 / 並び順 / 向き / 選択 / ゴミ箱 の順に並ぶ", () => {
  const html = render("compact", "updated", "", 51);
  const order = [
    'aria-label="検索ヘルプ"',
    'aria-label="カレンダー"',
    'aria-label="表示:',
    'aria-label="並び順:',
    'aria-label="並び順の向き:',
    ">選択<",
    'aria-label="ゴミ箱 (51 件)"',
  ].map((needle) => html.indexOf(needle));
  expect(order.every((index) => index >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("ゴミ箱が空ならゴミ箱へのリンクを出さない", () => {
  expect(render()).not.toContain('href="/trash"');
});

// 収まらない分は帯の中だけ横へ送る (折り返すと見出し行が 2 行になる)
test("帯は横に送れる窓で、スクロールバーは出さない", () => {
  const html = render();
  expect(html).toContain("overflow-x-auto");
  expect(html).toContain("[scrollbar-width:none]");
});

// モジュールの表示 (docs/126 §1-3)。登録口 (src/modules/registry.tsx) の一覧から出す
test("カレンダーへ移る釦を出す", () => {
  const html = render();
  expect(html).toContain('aria-label="カレンダー"');
});
