import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EditToolbar } from "./EditToolbar";

// 静的描画で 9 ボタン (更新 + 8 ツール) が出ることを確かめる。ラベルは呼び出し側
// (MemoEditorInner) が progressLabels で作った文字列をそのまま受けるので、
// ここでは代表値を渡す。押下時の挙動 (portal・requestSubmit・録音等) はブラウザで確認。
const noop = () => {};

const render = (overrides: Partial<Parameters<typeof EditToolbar>[0]> = {}) =>
  renderToStaticMarkup(
    <EditToolbar
      onSubmit={noop}
      canUndo={false}
      canRedo={false}
      onUndo={noop}
      onRedo={noop}
      uploadLabel="画像を挿入"
      uploading={false}
      onInsertFile={noop}
      scanLabel="スキャン"
      onScan={noop}
      recordLabel="録音"
      isRecording={false}
      recordDisabled={false}
      onToggleRecord={noop}
      onRecordVideo={noop}
      onDraw={noop}
      ocrLabel="画像をOCR"
      onOcr={noop}
      secretLabel="秘密"
      onSecret={noop}
      busy={false}
      {...overrides}
    />,
  );

test("更新 と 8 つのツールをすべて描く", () => {
  const html = render();
  for (const label of [
    "更新",
    "元に戻す",
    "やり直す",
    "画像を挿入",
    "スキャン",
    "録音",
    "録画",
    "お絵かき",
    "画像をOCR",
    "秘密",
  ]) {
    expect(html).toContain(label);
  }
});

test("進捗ラベルはそのまま表示する (アップロード%・OCR件数など)", () => {
  const html = render({ uploadLabel: "アップロード中 50%", ocrLabel: "OCR中 (2)" });
  expect(html).toContain("アップロード中 50%");
  expect(html).toContain("OCR中 (2)");
});

// カーソルがシークレット記法の上にあるかで呼び出し側が文字を変える
// (docs/52-シークレット編集導線計画.md §1)。ここは受け取って描くだけ
test("シークレットのラベルもそのまま表示する (秘密 / 秘密を編集)", () => {
  expect(render({ secretLabel: "秘密を編集" })).toContain("秘密を編集");
});

// undo/redo は履歴が無ければ disabled。属性だけ数える (class の disabled: と混同しない)
test("履歴が無いとき 元に戻す/やり直す は disabled", () => {
  const html = render({ canUndo: false, canRedo: false });
  // 更新は pending でないので有効、undo/redo の 2 つだけが disabled
  expect(html.match(/disabled=""/g)?.length).toBe(2);
});
