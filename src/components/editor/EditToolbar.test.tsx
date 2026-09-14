import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EditToolbar, type EditToolbarEditor } from "./EditToolbar";

// 静的描画で 15 ボタン (更新 + 14 ツール) が出ることを確かめる。ラベルは呼び出し側
// (MemoEditorInner) が progressLabels で作った文字列をそのまま受けるので、
// ここでは代表値を渡す。押下時の挙動 (portal・requestSubmit・録音等) はブラウザで確認。
const noop = () => {};

const IDLE: EditToolbarEditor = {
  submit: noop,
  busy: false,
  history: { canUndo: false, canRedo: false, undo: noop, redo: noop },
  upload: { label: "画像を挿入", uploading: false, open: noop },
  pasteClipboard: noop,
  scan: { label: "スキャン", open: noop },
  record: { label: "録音", isRecording: false, disabled: false, toggle: noop },
  recordVideo: noop,
  draw: noop,
  ocr: { label: "画像をOCR", run: noop },
  secret: { label: "秘密", open: noop },
  livePreview: { on: false, toggle: noop },
  format: noop,
  addPage: noop,
  find: noop,
};

const render = (editor: EditToolbarEditor = IDLE) =>
  renderToStaticMarkup(<EditToolbar editor={editor} />);

test("更新 と 14 のツールをすべて描く", () => {
  const html = render();
  for (const label of [
    "更新",
    "元に戻す",
    "やり直す",
    "検索",
    "ページ",
    "画像を挿入",
    "貼り付け",
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
  expect(render()).toContain("装飾表示");

  const on = render({ ...IDLE, livePreview: { ...IDLE.livePreview, on: true } });
  expect(on).toContain("記法を表示");
  expect(on).toContain('aria-pressed="true"');
});

test("進捗ラベルはそのまま表示する (アップロード%・OCR件数など)", () => {
  const html = render({
    ...IDLE,
    upload: { ...IDLE.upload, label: "アップロード中 50%" },
    ocr: { ...IDLE.ocr, label: "OCR中 (2)" },
  });
  expect(html).toContain("アップロード中 50%");
  expect(html).toContain("OCR中 (2)");
});

// カーソルがシークレット記法の上にあるかで呼び出し側が文字を変える
// (docs/52-シークレット編集導線計画.md §1)。ここは受け取って描くだけ
test("シークレットのラベルもそのまま表示する (秘密 / 秘密を編集)", () => {
  expect(render({ ...IDLE, secret: { ...IDLE.secret, label: "秘密を編集" } })).toContain(
    "秘密を編集",
  );
});

// undo/redo は履歴が無ければ disabled。属性だけ数える (class の disabled: と混同しない)
test("履歴が無いとき 元に戻す/やり直す は disabled", () => {
  const html = render();
  // 更新は pending でないので有効、undo/redo の 2 つだけが disabled
  expect(html.match(/disabled=""/g)?.length).toBe(2);
});

// ページを足す ＋ (docs/74-ページ計画.md §5)。挿入系のボタンなので帯の前寄り。
// **書式と違って帯の中でよい** — メニューを開かないので切り取られる物が無い
test("ページ追加は横スクロール帯の中に置く", () => {
  const html = render();
  expect(html.indexOf("overflow-x-auto")).toBeLessThan(html.indexOf("ページ"));
});

// ノート内検索 (docs/76-ノート内検索計画.md §2)。長押しで置換つきで開くので、
// 押した意味が 2 通りあることを読み上げにも出す
test("検索は長押しで置換つきで開くことを説明に持つ", () => {
  const html = render();
  expect(html).toContain("長押しで置換");
});

// クリップボードから取り込む (docs/92-クリップボード連携計画.md §4)。
// **画像ボタンの隣**に置く — どちらも「外から持ってきたものを添付にする」
// 操作なので、探す場所が離れていると片方を見落とす
test("貼り付けは画像を挿入の直後に並べる", () => {
  const html = render();
  const image = html.indexOf("画像を挿入");
  const paste = html.indexOf("貼り付け");
  expect(image).toBeLessThan(paste);
  expect(paste).toBeLessThan(html.indexOf("録音"));
});

// アップロード中・OCR 中に押されると、走っている挿入と取り込みが混ざる
test("処理中は貼り付けも止める", () => {
  const busy = render({ ...IDLE, busy: true });
  const idle = render();
  expect(busy.match(/disabled=""/g)?.length).toBeGreaterThan(
    idle.match(/disabled=""/g)?.length ?? 0,
  );
});

// 帯のボタンは ToolButton に、更新は SubmitButton に寄せてある
// (docs/93-リファクタリング計画.md §3-2)。上のテストはラベルと一部の属性しか
// 見ないので、ボタンごとの属性 (disabled・aria-pressed の有無) やアイコンの色の
// 取り違えはここで拾う。EditToolbar.snapshot.json は寄せる前の描画から取った。
//
// 2 つの状態で、止める・止めない / 押下あり・なし / 色の切り替え / 録音中の点を
// すべて一度ずつ通す
test("帯のボタンと更新の描画は寄せる前と同じ", async () => {
  const snapshot = {
    既定: render(),
    "履歴あり・処理中・録音中・装飾表示": render({
      ...IDLE,
      history: { ...IDLE.history, canUndo: true, canRedo: true },
      upload: { ...IDLE.upload, uploading: true },
      record: { ...IDLE.record, isRecording: true, disabled: true },
      livePreview: { ...IDLE.livePreview, on: true },
      busy: true,
    }),
  };

  await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(
    "./EditToolbar.snapshot.json",
  );
});
