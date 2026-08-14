// 検索画面のペイン構成 (docs/86 §4-4)。ヘッダーのアイコンで循環させる。
//
//   3 … フォルダー + 検索結果 + ノート。**ノートを必ず出す** —
//       開いていなければ検索結果の先頭を選んで出し、検索語を打ち替えても
//       ページを送っても勝手に閉じない。**幅に関係なくこの形** (docs/86 §4-9)
//       — 選んだ以上、狭いウィンドウでも 3 ペインで通す。
//   2 … 検索結果 + ノート。**ペインとして出ている間 (lg 以上) は 3 と同じで、
//       ノートを必ず出す** — 開いていなければ先頭を選ぶ。狭い画面では
//       ノートが全画面になるので、そこは開いたときだけ (出しっぱなしにすると
//       一覧が覆われて戻れない)。
//   1 … 検索結果だけ。ノートを開くと全画面になる (幅に関係なく)。
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

// 既定は 2。**どの幅でも破綻しない構成**を初期値にする — 3 は幅に関係なく
// 3 ペインで通すので (§4-9)、既定にするとスマホの初回表示がフォルダーで
// 埋まる。2 なら広い画面ではノートのペインが出て、狭い画面ではノートが
// 全画面 = この機能が入る前とまったく同じ見た目になる。
// 3 ペインは端末ごとに 1 度選べば cookie が 1 年覚えている
export const DEFAULT_PANE_MODE = "2" satisfies PaneMode;

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

// ノートのペインを「常に出しておく」か。**ペインとして出る構成 (3 / 2) は
// 出しっぱなし** — 検索語を打ち替えてもページを送っても閉じない。
// 1 は全画面なので当てはまらない。
//
// 2 の狭い画面 (ノートが全画面になる幅) だけは例外で、そこは呼ぶ側
// (PreviewPane) が CSS で畳む — 出しっぱなしにすると一覧が覆われたまま
// 戻れなくなる (実機で判明。docs/86 §4-9)
export function keepsNoteOpen(mode: PaneMode): boolean {
  return mode !== "1";
}

// 何も選んでいないときに検索結果の先頭を出すか (ノートのペインを持つ構成)。
// 1 ペインは「検索結果だけ」なので出さない
export function showsAutoNote(mode: PaneMode): boolean {
  return mode !== "1";
}

// ノートの器の畳み方 (docs/86 §4-9)。
//
//   pane       … 幅に関係なく下部のペイン (3 ペインを選んだとき)
//   pane-lg    … lg 以上だけペイン、狭い画面では全画面 (2 ペイン)
//   fullscreen … 幅に関係なく全画面 (1 ペイン)
export type NotePaneLayout = "pane" | "pane-lg" | "fullscreen";

export function notePaneLayout(mode: PaneMode): NotePaneLayout {
  switch (mode) {
    case "3":
      return "pane";
    case "2":
      return "pane-lg";
    case "1":
      return "fullscreen";
  }
}

// cookie の寿命 (秒)。1 年 — 好みなので次に自分で変えるまで続く
export const PANE_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
