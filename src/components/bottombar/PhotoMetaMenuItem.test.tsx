import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import {
  __setSavedPhotoMetaModeForTest,
  PhotoMetaMenuItem,
} from "./PhotoMetaMenuItem";

afterEach(() => {
  __setSavedPhotoMetaModeForTest(null);
});

// TextSizeMenuItem.test.tsx と同じ制約 — jsdom を持たないので、確かめられるのは
// 開いた直後の描画まで。押して保存する流れはブラウザで実物を通して確認する
// (docs/113-写真の撮影情報削除計画.md §7 Phase 4)
const render = (value: "strip" | "keep") =>
  renderToStaticMarkup(<PhotoMetaMenuItem value={value} />);

test("行の名前と、消す / 残すの 2 択を読み上げ用の名前付きで出す", () => {
  const html = render("strip");

  expect(html).toContain("写真の撮影情報 (EXIF)");
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('aria-label="写真の撮影情報 (EXIF)"');
  expect(html).toContain(">消す</button>");
  expect(html).toContain(">残す</button>");
});

test("いまの値だけを選択中にする", () => {
  const strip = render("strip");
  const keep = render("keep");

  expect(strip).toMatch(/aria-checked="true"[^>]*>消す</);
  expect(strip).toMatch(/aria-checked="false"[^>]*>残す</);
  expect(keep).toMatch(/aria-checked="false"[^>]*>消す</);
  expect(keep).toMatch(/aria-checked="true"[^>]*>残す</);
});

// 「残す」を選ぶ前に、何が残って誰に見えるかを言う。切り替えが過去の写真に
// 効かないことも書く (消した情報は戻らない)
test("何が残り誰に見えるか、どれに効くかを添える", () => {
  const html = render("strip");

  expect(html).toContain("写真と動画");
  expect(html).toContain("位置・日時・機種");
  expect(html).toContain("公開ノートからも読めます");
  expect(html).toContain("これから上げるもの");
});

test("開いた直後は保存の失敗を出さない", () => {
  expect(render("keep")).not.toContain('role="alert"');
});

// メニューは閉じると行ごと捨てられ、開き直すと描き直される (HeaderMenu は開いて
// いる間だけ中身を描く)。layout が読んだ値はクライアント遷移では読み直されない
// ので、それを信じると「残す」を保存した後に開き直すと「消す」と出てしまう
test("このタブで保存できた値があれば、layout が読んだ古い値より優先する", () => {
  __setSavedPhotoMetaModeForTest("keep");

  const html = render("strip");

  expect(html).toMatch(/aria-checked="true"[^>]*>残す</);
  expect(html).toMatch(/aria-checked="false"[^>]*>消す</);
});
