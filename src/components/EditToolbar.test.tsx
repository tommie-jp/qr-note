import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EditToolbar } from "./EditToolbar";

// 静的描画で 11 ボタン (更新 + 10 ツール) が出ることを確かめる。ラベルは呼び出し側
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
      livePreview={false}
      onToggleLivePreview={noop}
      onFormat={noop}
      busy={false}
      {...overrides}
    />,
  );

test("更新 と 11 のツールをすべて描く", () => {
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
    "装飾表示",
    "書式",
  ]) {
    expect(html).toContain(label);
  }
});

// 書式メニューは押すまで開かない (帯に 6 項目を並べない。docs/70 §6)
test("書式メニューは既定で閉じている", () => {
  const html = render();
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("チェックボックス");
});

// **書式ボタンは横スクロール帯の外に置く。**
//
// 帯は overflow-x-auto を持ち、CSS の規定で片方が visible でなくなると
// もう片方 (overflow-y) も visible ではなくなる。メニューは帯の上端より上へ
// 開くので、中に入れると切り取られて「押しても何も出ない」になる
// (実機で発生し修正した)。帯より前に出ていることを位置で押さえる
test("書式ボタンは横スクロール帯の中に入れない (メニューが切れる)", () => {
  const html = render();
  expect(html.indexOf("書式")).toBeLessThan(html.indexOf("overflow-x-auto"));
});

// ライブプレビューの切り替え (docs/70-編集ライブプレビュー計画.md §4)。
// ボタンの文字は**次に何が起きるか**を言う: OFF なら「装飾表示」(押すと装飾に
// なる)、ON なら「記法を表示」(押すと生記法に戻る)
test("ライブプレビューの ON/OFF で文字と押下状態が変わる", () => {
  expect(render({ livePreview: false })).toContain("装飾表示");

  const on = render({ livePreview: true });
  expect(on).toContain("記法を表示");
  expect(on).toContain('aria-pressed="true"');
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
