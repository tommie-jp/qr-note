import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SecretKeyringManager } from "./SecretKeyringManager";

// 鍵の設定画面の初期描画 (docs/51-部分暗号化計画.md §6)。鍵束は effect で取る
// ので、サーバ描画で見えるのは「読み込み中」だけ。
//
// 「この環境ではパスキーを使えません」はブラウザで確かめた結果だけで出す。
// サーバ描画で出してしまうと、パスキーが使えるブラウザでは hydration の直後に
// 消えることになり、React が「サーバと違う」と警告する (dev で実際に出ていた)
test("サーバ描画は読み込み中だけで、パスキー非対応の注意は出さない", () => {
  const html = renderToStaticMarkup(<SecretKeyringManager />);

  expect(html).toContain("読み込み中…");
  expect(html).not.toContain("この環境ではパスキーを使えません");
});
