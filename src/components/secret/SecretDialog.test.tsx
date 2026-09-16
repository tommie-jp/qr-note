import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { DEFAULT_SECRET_LABEL } from "@/lib/secret/secrets";
import { SecretDialog, type SecretDialogProps } from "./SecretDialog";

// SecretTools の DrawModal・ScannerModal は next/dynamic で開くまで読まない。
// サーバ描画は loader を待てないので、席だけを描く差し替えに向ける
// (docs/96-シークレット・お絵かきのテスト計画.md §4-1)
vi.mock("next/dynamic", () => import("@/test/dynamicStub"));

// ModalOverlay は document.body へ portal する。サーバ描画に document は無く、
// react-dom/server も portal を描けないので、中身をその場に描く形に差し替える
// (renderToStaticMarkup は react-dom/server から読むので影響を受けない)。
// 引数の document.body は差し替えた createPortal に届く前に評価されるので、
// body だけを持つ document も置く
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});

beforeAll(() => {
  vi.stubGlobal("document", { body: {} });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const NAME = "0123abcd-4567-89ab-cdef-0123456789ab";

const noop = () => {};

const NEW: SecretDialogProps = {
  name: null,
  initialText: "",
  initialLabel: "",
  onSaved: noop,
  onClose: noop,
};

const render = (props: Partial<SecretDialogProps> = {}) =>
  renderToStaticMarkup(<SecretDialog {...NEW} {...props} />);

// text を含む button の開始タグから閉じタグまで (先頭の断片は button の前なので除く)
const buttonWith = (html: string, text: string) =>
  html
    .split("<button ")
    .slice(1)
    .map((part) => part.slice(0, part.indexOf("</button>")))
    .find((part) => part.includes(text)) ?? "";

// 新規 (docs/51-部分暗号化計画.md §8)。ラベル欄は空で既定名を placeholder に、
// 本文は空、保存はすぐ押せる
test("新規は空のラベルと本文で開き、暗号化して保存 が押せる", () => {
  const html = render();

  expect(html).toContain("シークレットを挿入");
  expect(html).not.toContain("シークレットを編集");
  expect(html).toContain("ラベル (本文に平文で残ります)");
  expect(html).toContain(`placeholder="${DEFAULT_SECRET_LABEL}"`);
  expect(html).toContain('<textarea rows="10" autofocus="" spellCheck="false"');
  expect(html).toContain("></textarea>");
  expect(html).toContain("暗号化して保存");
  expect(html).not.toContain("保存中");
  expect(html).not.toContain('disabled=""');
  expect(html).not.toContain("画像の参照が含まれています");
  expect(html).toContain("閉じる");
});

// 拡張のスペルチェック (Grammarly など) は打った文字をそのまま自社サーバへ送る。
// 入力欄の両方から入力補助を切っていることを固定する (復旧キー欄と同じ流儀)
test("ラベルと本文の入力欄は入力補助をすべて切る", () => {
  const html = render();

  for (const tag of ['<input type="text"', "<textarea"]) {
    const field = html.slice(html.indexOf(tag), html.indexOf(">", html.indexOf(tag)));
    expect(field).toContain('spellCheck="false"');
    expect(field).toContain('autoComplete="off"');
    expect(field).toContain('autoCorrect="off"');
    expect(field).toContain('autoCapitalize="off"');
    expect(field).toContain('data-gramm="false"');
    expect(field).toContain('data-gramm_editor="false"');
    expect(field).toContain('data-enable-grammarly="false"');
  }
});

// 6 つの道具 (SecretToolbar) を本文の下に持ち、開くまで読まない部品の席は
// 初期状態では出ない (お絵かき・スキャンは押してから)
test("道具の帯を本文の下に描き、モーダルの席はまだ置かない", () => {
  const html = render();

  expect(html.indexOf("<textarea")).toBeLessThan(html.indexOf("お絵かき"));
  expect(html).toContain("スキャン");
  expect(html).not.toContain("data-dynamic-stub");
  expect(html).not.toContain('role="dialog"');
});

// 選択範囲を引き継いで開く (docs/51 §12 の移行導線)。通常の画像は images
// テーブルに平文で残るので、参照が含まれていたら注意を出す
test("初期本文に通常の画像参照があれば注意を出す", () => {
  const html = render({ initialText: "秘密\n![写真](/api/images/a.png)\n" });

  expect(html).toContain("![写真](/api/images/a.png)");
  expect(html).toContain("画像の参照が含まれています");
  expect(html).toContain("通常の画像はサーバに平文のまま残ります");
});

test("シークレット記法の参照では注意を出さない", () => {
  const html = render({ initialText: `![秘密](/api/secrets/${NAME})` });

  expect(html).not.toContain("画像の参照が含まれています");
});

// 既存の断片 (name あり) は復号してから開く。それまで本文・道具・保存を止める
// (閉じるだけは押せる)
test("既存の断片は読み込み中として開き、本文・道具・保存を止める", () => {
  const html = render({ name: NAME, initialLabel: "パスワード" });

  expect(html).toContain("シークレットを編集");
  expect(html).toContain('value="パスワード"');
  // textarea 1 + 道具 6 + 保存 1 = 8。閉じる は止めない
  expect(html.match(/disabled=""/g)?.length).toBe(8);
  const textarea = html.slice(html.indexOf("<textarea"), html.indexOf("</textarea>"));
  expect(textarea).toContain('disabled=""');
  expect(buttonWith(html, "閉じる")).not.toContain('disabled=""');
  expect(buttonWith(html, "暗号化して保存")).toContain('disabled=""');
});

// 閲覧画面から開いたとき (docs/52-シークレット編集導線計画.md §2)。ラベルは
// 本文の平文なのでここでは変えられない。何を編集しているかだけ示す
test("hideLabel はラベル欄の代わりに見出しだけを出す", () => {
  const html = render({ name: NAME, initialLabel: "パスワード", hideLabel: true });

  expect(html).not.toContain("ラベル (本文に平文で残ります)");
  expect(html).not.toContain('<input type="text"');
  expect(html).toContain(">パスワード</p>");
});

test("ラベルの初期値は HTML として解釈しない", () => {
  const html = render({ initialLabel: "<b>x</b>" });

  expect(html).not.toContain("<b>x</b>");
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
});
