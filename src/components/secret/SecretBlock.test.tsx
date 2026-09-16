import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { SecretBlock } from "./SecretBlock";

// MarkdownView・SecretDialog は next/dynamic で開くまで読まない。サーバ描画は
// loader を待てないので、席だけを描く差し替えに向ける
// (docs/96-シークレット・お絵かきのテスト計画.md §4-1)
vi.mock("next/dynamic", () => import("@/test/dynamicStub"));

// 解錠状態はブラウザのメモリにしかなく、サーバ描画では常に施錠 (secret/session.ts)。
// 「解錠済みだが未表示」を作るため、useSecretUnlocked だけを差し替える
const mocks = vi.hoisted(() => ({ unlocked: false }));

vi.mock("@/lib/secret/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/secret/session")>();
  return { ...actual, useSecretUnlocked: () => mocks.unlocked };
});

afterEach(() => {
  mocks.unlocked = false;
});

const NAME = "0123abcd-4567-89ab-cdef-0123456789ab";

const render = (props: Partial<Parameters<typeof SecretBlock>[0]> = {}) =>
  renderToStaticMarkup(<SecretBlock name={NAME} label="パスワード" {...props} />);

// 既定は「🔒 ラベル」のプレースホルダ (docs/51-部分暗号化計画.md §9)。
// 中身は押すまで取りに行かないので、展開時の操作 (隠す・コピー・編集) も無い
test("施錠中は 🔒 とラベルのボタンだけを描く", () => {
  const html = render();

  expect(html).toContain('<button type="button"');
  expect(html).toContain("🔒");
  expect(html).toContain("パスワード");
  expect(html).not.toContain('disabled=""');
  expect(html).not.toContain("animate-spin");
  expect(html).not.toContain("🔓");
  expect(html).not.toContain("隠す");
  expect(html).not.toContain("コピー");
  expect(html).not.toContain("編集");
  expect(html).not.toContain("<img");
});

// 解錠済みでも**押すまでは出さない** (肩越しの覗き見対策)。解錠は「押したときに
// 認証器を呼ぶかどうか」を変えるだけで、描画は施錠中と一字一句同じ
test("解錠済みでも押すまでは施錠中と同じ表示", () => {
  const locked = render();
  mocks.unlocked = true;

  const unlocked = render();

  expect(unlocked).toBe(locked);
});

// 編集は展開してから出す (docs/52 §2)。畳んだ状態では allowEdit があっても出ない
test("allowEdit があっても畳んだ状態では編集を出さない", () => {
  const html = render({ allowEdit: true });

  expect(html).not.toContain("編集");
  expect(html).toBe(render());
});

// MarkdownView・SecretDialog の席は展開するまで置かない
// (シークレットを使わないノートの表示を重くしないため。SecretBlock.tsx の注)
test("畳んだ状態では動的に読む部品の席を置かない", () => {
  const html = render();

  expect(html).not.toContain("data-dynamic-stub");
});

test("ラベルは HTML として解釈しない", () => {
  const html = render({ label: "<b>x</b>" });

  expect(html).not.toContain("<b>x</b>");
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
});
