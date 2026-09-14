import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EditorBanners } from "./EditorBanners";

const QUIET = {
  error: null,
  recordingNote: null,
  videoRecordingNote: null,
  ocr: { ocrNote: null, ocrCount: 0, modelPercent: null },
  scan: { scanNote: null, scanBusy: false },
};

test("知らせが無ければ何も描かない", () => {
  expect(renderToStaticMarkup(<EditorBanners {...QUIET} />)).toBe("");
});

// DOM の並びは囲みの space-y の間隔に効くので、分ける前の順を押さえる
test("エラー → 録音 → 録画 → OCR → スキャンの順に並べる", () => {
  // Arrange
  const all = {
    error: "E",
    recordingNote: "R",
    videoRecordingNote: "V",
    ocr: { ocrNote: "O", ocrCount: 1, modelPercent: null },
    scan: { scanNote: "S", scanBusy: true },
  };

  // Act
  const html = renderToStaticMarkup(<EditorBanners {...all} />);

  // Assert
  const order = ["E", "R", "V", "O", "S"].map((text) => html.indexOf(`>${text}`));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order.every((index) => index >= 0)).toBe(true);
});

// % は読み上げに毎ティック流さない
test("モデル取得の % は aria-hidden で OCR の知らせに添える", () => {
  // Arrange
  const props = {
    ...QUIET,
    ocr: { ocrNote: "OCR モデルを準備しています…", ocrCount: 1, modelPercent: 42 },
  };

  // Act
  const html = renderToStaticMarkup(<EditorBanners {...props} />);

  // Assert
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('<span aria-hidden="true"> 42%</span>');
});

test("OCR が終わった後の知らせは busy を下ろす", () => {
  // Arrange
  const props = {
    ...QUIET,
    ocr: { ocrNote: "画像から文字が見つかりませんでした。", ocrCount: 0, modelPercent: null },
  };

  // Act
  const html = renderToStaticMarkup(<EditorBanners {...props} />);

  // Assert
  expect(html).toContain('aria-busy="false"');
  expect(html).not.toContain("%");
});
