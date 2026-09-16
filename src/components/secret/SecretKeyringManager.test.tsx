import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { keyringView } from "@/lib/secret/keyringView";
import { SecretKeyringManager } from "./SecretKeyringManager";

// 解錠状態はブラウザのメモリにしかなく、サーバ描画では常に施錠 (secret/session.ts)。
// 「解錠済み」を作るため、useSecretUnlocked だけを差し替える
const mocks = vi.hoisted(() => ({ unlocked: false }));

vi.mock("@/lib/secret/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/secret/session")>();
  return { ...actual, useSecretUnlocked: () => mocks.unlocked };
});

afterEach(() => {
  mocks.unlocked = false;
});

const render = () => renderToStaticMarkup(<SecretKeyringManager />);

// text を含む button の開始タグから閉じタグまで (先頭の断片は button の前なので除く)
const buttonWith = (html: string, text: string) =>
  html
    .split("<button ")
    .slice(1)
    .map((part) => part.slice(0, part.indexOf("</button>")))
    .find((part) => part.includes(text)) ?? "";

// 鍵の設定画面の初期描画 (docs/51-部分暗号化計画.md §6)。鍵束は effect で取る
// ので、サーバ描画で見えるのは「読み込み中」だけ。
//
// 「この環境ではパスキーを使えません」はブラウザで確かめた結果だけで出す。
// サーバ描画で出してしまうと、パスキーが使えるブラウザでは hydration の直後に
// 消えることになり、React が「サーバと違う」と警告する (dev で実際に出ていた)
test("サーバ描画は読み込み中だけで、パスキー非対応の注意は出さない", () => {
  const html = render();

  expect(html).toContain("読み込み中…");
  expect(html).not.toContain("この環境ではパスキーを使えません");
});

// 読み込み前は「設定する」の節だけを出し、鍵束が来るまで押せない。
// 解錠・有効化・一覧は鍵束を見てから (どの節を出すかは lib/secret/keyringView.ts)
test("読み込み中は 設定する の節だけを出し、ボタンは押せない", () => {
  const html = render();

  expect(html).toContain("暗号化を設定する");
  expect(buttonWith(html, "設定する")).toContain('disabled=""');
  expect(html.match(/disabled=""/g)?.length).toBe(1);
  expect(html).not.toContain("解錠する");
  expect(html).not.toContain("この端末のパスキーで解錠できるようにする");
  expect(html).not.toContain(">復旧キーを表示</button>");
  expect(html).not.toContain("パスキーごとの状態");
  expect(html).not.toContain("復旧キー — いま紙に控えてください");
});

// 部品は keyringView の結果から描く。サーバ描画の状態文がその読み込み前の
// 値と一致することで、切り出し前後の描画が同じことを押さえる
test("状態の文は keyringView の読み込み前の値そのもの", () => {
  const view = keyringView({
    keyring: null,
    unlocked: false,
    webAuthnAvailable: true,
  });

  const html = render();

  expect(html).toContain(`>${view.status}</p>`);
  expect(view.lockNote).toBeNull();
  expect(html).not.toContain("いまは施錠中です");
  expect(html).not.toContain("いまは解錠中です");
});

// 解錠していても鍵束が来るまでは何も増えない (設定済みかどうかは鍵束が決める)
test("解錠済みでも読み込み中の描画は施錠中と同じ", () => {
  const locked = render();
  mocks.unlocked = true;

  const unlocked = render();

  expect(unlocked).toBe(locked);
});
