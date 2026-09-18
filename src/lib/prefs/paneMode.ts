// 検索画面のペイン構成 (docs/86 §4-4)。ヘッダーのアイコンで循環させる。
//
//   3 … フォルダー + 検索結果 + ノート。**ノートを必ず出す** —
//       開いていなければ検索結果の先頭を選んで出し、検索語を打ち替えても
//       ページを送っても勝手に閉じない。**幅に関係なくこの形** (docs/86 §4-9)
//       — 選んだ以上、狭いウィンドウでも 3 ペインで通す。
//   2 … 検索結果 + ノート。3 からフォルダーを抜いただけで、**ノートを必ず
//       出すのも幅に関係なくこの形なのも同じ** (docs/86 §4-16)。狭い画面では
//       上に検索結果、下にノートが並ぶ。
//   1 … 検索結果だけ。ノートを開くと全画面になる (幅に関係なく)。
//
// **URL ではなく cookie に持つ** — 表示モード (prefs/viewMode.ts) と同じ理由で、
// 「どう見たいか」という端末ごとの好みであって検索状態ではない。サーバが
// 描画前に読めるので、フォルダーペインを出すかどうかも初回描画から正しい。
//
// 幅との関係: どの構成も**幅では畳まない**。スマホでも選んだ構成のまま出る。
// 狭い画面で従来の見た目 (一覧 → 開くと全画面のノート、ページ全体を
// 引っ張って更新) が欲しければ 1 を選ぶ。

export type PaneMode = "3" | "2" | "1";

export const PANE_MODE_COOKIE = "panes";

// 既定は 2。検索結果とノートが 1 画面に並ぶ、このアプリの基本の形。
// 3 を既定にしないのは、狭い画面ではフォルダーが幅を取り過ぎるため
// (フォルダーは幅に関係なく出る。§4-9)。
// 3 / 1 は端末ごとに 1 度選べば cookie が 1 年覚えている
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
// 1 は全画面なので当てはまらない (出しっぱなしにすると一覧が覆われたまま
// 戻れなくなる)
export function keepsNoteOpen(mode: PaneMode): boolean {
  return mode !== "1";
}

// 何も選んでいないときに検索結果の先頭を出すか (ノートのペインを持つ構成)。
// 1 ペインは「検索結果だけ」なので出さない
export function showsAutoNote(mode: PaneMode): boolean {
  return mode !== "1";
}

// ノートの器の畳み方 (docs/86 §4-9)。どちらも幅には依らない。
//
//   pane       … 下部のペイン (3 / 2 ペイン)
//   fullscreen … 全画面 (1 ペイン)
//
// 2 ペインは以前「lg 以上だけペイン、狭い画面では全画面」だったが、
// スマホで検索結果とノートを並べられなかったので畳むのをやめた (§4-16)
export type NotePaneLayout = "pane" | "fullscreen";

export function notePaneLayout(mode: PaneMode): NotePaneLayout {
  return mode === "1" ? "fullscreen" : "pane";
}

// cookie の寿命 (秒)。1 年 — 好みなので次に自分で変えるまで続く
export const PANE_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
