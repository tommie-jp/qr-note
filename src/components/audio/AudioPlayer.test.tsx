import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { MarkdownView } from "../markdown/MarkdownView";
import { AudioPlayer } from "./AudioPlayer";

const render = (src: string, label: string) =>
  renderToStaticMarkup(<AudioPlayer src={src} label={label} />);

test("音声プレイヤー (<audio>) を描画する", () => {
  const html = render("/api/images/abc.wav", "録音 2026-07-20");
  expect(html).toContain("<audio");
  expect(html).toContain('src="/api/images/abc.wav"');
  expect(html).toContain("controls");
  // 勝手に鳴らさない
  expect(html).not.toContain("autoplay");
});

// 共有ボタンはブラウザの対応可否 (canShareFiles) を見てから出す。
// サーバ描画では出さない (useSyncExternalStore の getServerSnapshot が false)。
// これで「押しても失敗するボタン」が SSR で焼き付くのを防ぐ
test("サーバ描画では共有ボタンを出さない (機能検出はクライアントで)", () => {
  const html = render("/api/images/abc.wav", "audio");
  expect(html).not.toContain("共有");
});

// 本文の音声が AudioPlayer 経由になっていること (MarkdownView の配線)
test("MarkdownView の音声は AudioPlayer で描画する", () => {
  const html = renderToStaticMarkup(
    <MarkdownView markdown="![録音 2026-07-20](/api/images/abc.webm)" />,
  );
  expect(html).toContain("<audio");
  expect(html).toContain('src="/api/images/abc.webm"');
  expect(html).not.toContain("<img");
});
