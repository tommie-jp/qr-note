import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { ClipboardSlotMeta } from "@/lib/clipboard/slot";
import { ServerClipboardView } from "./ServerClipboardView";

// 部品の中のイベント処理は jsdom が無いので確かめられない (PhotoMetaMenuItem.test.tsx と
// 同じ制約)。ここでは状態ごとの描画を固定し、押す流れは
// lib/clipboard/serverClipboard.test.ts と E2E で確かめる (docs/114 §5)
const NOW = new Date("2026-10-25T12:03:00.000Z");
const TEXT: ClipboardSlotMeta = {
  kind: "text",
  bytes: 9,
  updatedAt: "2026-10-25T12:00:00.000Z",
  text: "あいう",
};
const IMAGE: ClipboardSlotMeta = {
  kind: "image",
  bytes: 1.2 * 1024 * 1024,
  updatedAt: "2026-10-25T12:00:30.000Z",
};

function render(overrides: Partial<Parameters<typeof ServerClipboardView>[0]> = {}) {
  return renderToStaticMarkup(
    <ServerClipboardView
      slot={null}
      loadFailed={false}
      busy={null}
      notice={null}
      now={NOW}
      onSend={vi.fn()}
      onReceive={vi.fn()}
      onClear={vi.fn()}
      {...overrides}
    />,
  );
}

test("2 行の名前は「サーバへコピー」と「サーバからペースト」", () => {
  const html = render();

  expect(html).toContain("サーバへコピー");
  expect(html).toContain("サーバからペースト");
});

test("中身が無ければペーストは押せず、「なし」と出す", () => {
  const html = render({ slot: null });

  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*サーバからペースト/);
  expect(html).toContain("なし");
  expect(html).not.toContain(">消す<");
});

test("読み込み中はペーストを押せず、「確認中…」と出す", () => {
  const html = render({ slot: undefined });

  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*サーバからペースト/);
  expect(html).toContain("確認中…");
});

test("文字が入っていれば字数と経過時間を出す", () => {
  const html = render({ slot: TEXT });

  expect(html).toContain("文字 3 字");
  expect(html).toContain("3 分前");
  expect(html).toContain(">消す<");
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^]*サーバからペースト/);
});

test("画像が入っていれば大きさを出す", () => {
  const html = render({ slot: IMAGE });

  expect(html).toContain("画像 1.2MB");
  expect(html).toContain("2 分前");
});

// 押す前に「消える」ことと、送るときに許可が要ることを言う
test("10 分で消えること・許可が要ることを添える", () => {
  const html = render();

  expect(html).toContain("10 分で消えます");
  expect(html).toContain("読み取りを許可");
});

test("送信中は送る行の文言が変わり、二重押しを止める", () => {
  const html = render({ busy: "send", slot: TEXT });

  expect(html).toContain("送っています…");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*送っています/);
});

test("受け取り中は文言が変わる", () => {
  const html = render({ busy: "receive", slot: TEXT });

  expect(html).toContain("コピーしています…");
});

test("成功の知らせは role=status、失敗は role=alert", () => {
  const ok = render({ notice: { tone: "ok", text: "サーバへ送りました" } });
  const ng = render({ notice: { tone: "error", text: "文字が大きすぎます (最大 64KB)" } });

  expect(ok).toContain('role="status"');
  expect(ok).toContain("サーバへ送りました");
  expect(ng).toContain('role="alert"');
  expect(ng).toContain("文字が大きすぎます (最大 64KB)");
});

test("枠を読めなかったときは理由を出す (行は押せるまま)", () => {
  const html = render({ slot: null, loadFailed: true });

  expect(html).toContain("サーバの状態を読めませんでした");
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^]*サーバへコピー/);
});
