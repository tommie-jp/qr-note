import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SecretToolbar, type SecretToolbarProps } from "./SecretToolbar";

// シークレット入力ダイアログのツール行 (docs/53-シークレット挿入拡張計画.md §4)。
// 状態とハンドラは SecretTools が持ち、ここは受けて描くだけなので、静的描画で
// ボタンの並び・止め方・文言を固定する (editor/EditToolbar.test.tsx と同じ流儀)
const noop = () => {};

const IDLE: SecretToolbarProps = {
  disabled: false,
  onInsertImage: noop,
  onDraw: noop,
  recordLabel: "録音",
  isRecording: false,
  onToggleRecord: noop,
  onRecordVideo: noop,
  ocrLabel: "画像をOCR",
  onOcr: noop,
  onScan: noop,
};

const render = (props: Partial<SecretToolbarProps> = {}) =>
  renderToStaticMarkup(<SecretToolbar {...IDLE} {...props} />);

// 録音ボタンだけ aria-pressed を持つ。その button の開始タグから閉じタグまで
const recordButton = (html: string) =>
  html
    .split("<button ")
    .map((part) => part.slice(0, part.indexOf("</button>")))
    .find((part) => part.includes("aria-pressed")) ?? "";

test("6 つの道具を 画像・録音・録画・お絵かき・OCR・スキャン の順に描く", () => {
  const html = render();

  const positions = ["画像", "録音", "録画", "お絵かき", "画像をOCR", "スキャン"].map(
    (label) => html.indexOf(label),
  );
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(html.match(/<button /g)?.length).toBe(6);
});

test("待機中はどのボタンも止めず、録音は押していない状態", () => {
  const html = render();

  expect(html).not.toContain('disabled=""');
  expect(recordButton(html)).toContain('aria-pressed="false"');
  expect(html).not.toContain("animate-pulse");
});

test("処理中は 6 つとも止める", () => {
  const html = render({ disabled: true });

  expect(html.match(/disabled=""/g)?.length).toBe(6);
});

// 録音中だけは処理中でも押せる。止められないと録音が終わらない
test("録音中は処理中でも録音ボタンだけ押せる", () => {
  const html = render({
    disabled: true,
    isRecording: true,
    recordLabel: "停止 0:05",
  });

  expect(html.match(/disabled=""/g)?.length).toBe(5);
  const record = recordButton(html);
  expect(record).not.toContain('disabled=""');
  expect(record).toContain('aria-pressed="true"');
  expect(record).toContain("停止 0:05");
});

// 録音中はマイクの絵の代わりに点滅する赤い点を出す (押せば止まると判るように)
test("録音中はマイクの代わりに点滅する点を描く", () => {
  const idle = recordButton(render());
  const recording = recordButton(render({ isRecording: true }));

  expect(idle).toContain("<svg");
  expect(idle).not.toContain("animate-pulse");
  expect(recording).toContain("animate-pulse");
  expect(recording).not.toContain("<svg");
});

// 文言は呼び出し側 (progressLabels) が作る。ここは受けたまま出す
test("録音と OCR の文言は受けたまま出す (経過時間・件数)", () => {
  const html = render({ recordLabel: "停止 1:23", ocrLabel: "OCR処理中 (2件)…" });

  expect(html).toContain("停止 1:23");
  expect(html).toContain("OCR処理中 (2件)…");
});
