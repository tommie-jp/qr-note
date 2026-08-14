// 検索画面のペイン構成 (docs/86 §4-4)。ヘッダーのアイコンで循環させる。
//
//   3 … フォルダー + 検索結果 + ノート。**ノートを必ず出す** —
//       開いていなければ検索結果の先頭を選んで出し、検索語を打ち替えても
//       ページを送っても勝手に閉じない。
//   2 … 検索結果 + ノート。ノートは開いたときだけ出る (閉じれば消える)。
//   1 … 検索結果だけ。ノートを開くと全画面になる (スマホと同じ畳み方)。
//
// **URL ではなく cookie に持つ** — 表示モード (viewMode.ts) と同じ理由で、
// 「どう見たいか」という端末ごとの好みであって検索状態ではない。サーバが
// 描画前に読めるので、フォルダーペインを出すかどうかも初回描画から正しい。
//
// 幅との関係: ペインはもともと広い画面でしか出ない (フォルダーは xl 以上、
// ノートのペインは lg 以上)。このモードは**その中でどう畳むか**を決める物で、
// スマホの見た目は 3 でも 1 でも変わらない。

export type PaneMode = "3" | "2" | "1";

export const PANE_MODE_COOKIE = "panes";

// 既定は 3。この機能が入る前の見た目 (フォルダーが出て、押したノートが
// 下に出る) にいちばん近い
export const DEFAULT_PANE_MODE = "3" satisfies PaneMode;

// **この並びがそのまま押したときの循環になる** (VIEW_MODES と同じ流儀)
export const PANE_MODES: readonly PaneMode[] = ["3", "2", "1"];

// cookie は利用者が自由に書き換えられる外部入力なので、素通しせず畳む
export function parsePaneMode(value: unknown): PaneMode {
  return PANE_MODES.includes(value as PaneMode)
    ? (value as PaneMode)
    : DEFAULT_PANE_MODE;
}

// 押したときの行き先 (3 → 2 → 1 → 3)
export function nextPaneMode(mode: PaneMode): PaneMode {
  const index = PANE_MODES.indexOf(mode);
  return PANE_MODES[(index + 1) % PANE_MODES.length];
}

export function paneModeLabel(mode: PaneMode): string {
  switch (mode) {
    case "3":
      return "3 ペイン (フォルダー・検索結果・ノート)";
    case "2":
      return "2 ペイン (検索結果・ノート)";
    case "1":
      return "1 ペイン (検索結果のみ)";
  }
}

// フォルダーペインを出すか (3 のときだけ)。出すかどうかはサーバが決める —
// クライアントで隠すと、出さない構成でもタグの集計を引いてしまう
export function showsFolderPane(mode: PaneMode): boolean {
  return mode === "3";
}

// ノートのペインを「常に出しておく」か (3 のときだけ)。
// 2 は開いたときだけ、1 は全画面に畳む
export function keepsNoteOpen(mode: PaneMode): boolean {
  return mode === "3";
}

// cookie の寿命 (秒)。1 年 — 好みなので次に自分で変えるまで続く
export const PANE_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
