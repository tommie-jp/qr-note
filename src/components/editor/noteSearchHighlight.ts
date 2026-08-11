import {
  getSearchQuery,
  search,
  selectNextOccurrence,
} from "@codemirror/search";
import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// ノート内検索の**見た目と入り口**を CodeMirror 側に足す拡張
// (docs/76-ノート内検索計画.md §3, §6)。探す計算は noteSearch.ts、
// 帯の UI は NoteSearchBar.tsx が持つ。
//
// ここが自前になっている理由は 1 つ:
//
//   @codemirror/search の標準ハイライトは `if (!panel || ...) return
//   Decoration.none` と書かれていて、**CodeMirror のパネルが開いている
//   ときしか装飾を作らない**。この app の検索バーは下部バーへ portal する
//   (= パネルを開かない) ので、そのままだと検索語を入れてもハイライトだけ
//   出ない。探す仕掛け (SearchQuery・setSearchQuery・findNext) は標準の
//   ままで、装飾を作る所だけを差し替える。

const matchMark = Decoration.mark({ class: "cm-noteSearchMatch" });

// いま選んでいる一致。「12 件のうちどれを見ているか」が判らないと、
// ∧ ∨ を押しても画面のどこが動いたのか追えない
const currentMark = Decoration.mark({
  class: "cm-noteSearchMatch cm-noteSearchMatch-current",
});

// 画面に見えている範囲だけを塗る。本文は上限 32,000 字だが、打つたびに全体を
// 走るのはもったいない (標準のハイライトも visibleRanges だけを見ている)
function buildHighlights(view: EditorView): DecorationSet {
  const query = getSearchQuery(view.state);
  if (!query.valid) {
    return Decoration.none;
  }
  const selection = view.state.selection.main;
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    const cursor = query.getCursor(view.state, range.from, range.to);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      const { from, to } = next.value;
      const isCurrent = from === selection.from && to === selection.to;
      builder.add(from, to, isCurrent ? currentMark : matchMark);
    }
  }
  return builder.finish();
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildHighlights(view);
    }

    update(update: ViewUpdate) {
      // 検索語の入れ替えは setSearchQuery で来る。**同一性で見る** —
      // 中身が同じでも作り直された query は塗り直せばよいだけで、
      // 取りこぼす側 (eq で早合点する) より安い
      const queryChanged =
        getSearchQuery(update.state) !== getSearchQuery(update.startState);
      if (
        queryChanged ||
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged
      ) {
        this.decorations = buildHighlights(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// 一致の色。黄で「ここに在る」、橙で「いま見ている 1 つ」を出す。
// ライブプレビューの装飾より下に敷かれる (Prec.low) ので、記法の色と喧嘩しない
const highlightTheme = EditorView.baseTheme({
  ".cm-noteSearchMatch": {
    backgroundColor: "rgba(250, 204, 21, 0.45)",
    borderRadius: "2px",
  },
  ".cm-noteSearchMatch-current": {
    backgroundColor: "rgba(249, 115, 22, 0.55)",
    outline: "1px solid rgba(194, 65, 12, 0.6)",
  },
});

// キーボードとスクロールから React 側を呼ぶ口。
//
// **中身を後から差し替えられる可変オブジェクト**にしてある。拡張は編集画面に
// つき一度しか組まない (MemoEditorInner の useMemo) ので、その場の関数を
// 直接渡すと「マウント時の state を見る関数」を永久に掴んだままになる。
// livePreviewCompartment と同じ「拡張と寿命を揃える」置き方 — 作るのは
// 拡張を組む場で、書き換えるのは描画のたびの effect。
export interface NoteSearchHooks {
  // Ctrl+F / Ctrl+H で帯を開く (React 側の state を触る)
  onOpen: (withReplace: boolean) => void;
  // F3 / Ctrl+G。帯が閉じていれば開く、開いていれば次 (前) の一致へ
  onFindNext: () => boolean;
  onFindPrev: () => boolean;
  // Escape で閉じる。閉じるものが無ければ false を返し、他の Escape
  // (補完を閉じる等) の邪魔をしない
  onEscape: () => boolean;
  // 一致へ飛ぶときに空けておく下の余白 (px)。ソフトキーボードと下部バーの
  // 高さぶん。**関数で受ける** — scrollMargins はスクロールのたびに呼ばれる
  // ので、拡張を組み直さずに値を変えられる (§6)
  bottomMargin: () => number;
}

export interface NoteSearchController {
  // CodeMirror へ渡す拡張一式。**参照は変えない** (変えると拡張が組み直される)
  extension: Extension;
  // 呼ぶ先を今の関数に差し替える。描画のたびに effect から呼ぶ
  update: (hooks: NoteSearchHooks) => void;
}

// 拡張と、その呼び出し先の差し替え口を**一緒に**作る。
//
// 可変の口をこの中に閉じ込めるのが要点 — 呼ぶ側 (React の部品) から見ると
// update() を呼ぶだけで、書き換わる物を自分では持たない。
// 差し替えるまでの間 (拡張を組んでから最初の effect まで) も鍵は押されうるので、
// 既定は「何もしない」にしておく (null 判定を毎回書かないため)
export function createNoteSearch(): NoteSearchController {
  const hooks: NoteSearchHooks = {
    onOpen: () => {},
    onFindNext: () => false,
    onFindPrev: () => false,
    onEscape: () => false,
    bottomMargin: () => 0,
  };
  return {
    extension: noteSearchExtension(hooks),
    update: (next) => {
      hooks.onOpen = next.onOpen;
      hooks.onFindNext = next.onFindNext;
      hooks.onFindPrev = next.onFindPrev;
      hooks.onEscape = next.onEscape;
      hooks.bottomMargin = next.bottomMargin;
    },
  };
}

function noteSearchExtension(hooks: NoteSearchHooks): Extension {
  return [
    // 検索状態 (StateField) の置き場。これが無いと setSearchQuery も
    // findNext も効かない。パネルは開かないので top/bottom は関係ない
    search(),
    Prec.low(highlighter),
    highlightTheme,
    EditorView.scrollMargins.of(() => ({ bottom: hooks.bottomMargin() })),
    // 標準の検索キーマップ (searchKeymap) は basicSetup 側で切ってある
    // (MemoEditorInner の BASIC_SETUP)。**切らないと標準パネルが開く経路が
    // 残る** — F3 / Ctrl+G は検索語が無いとき openSearchPanel へ落ちる作りで、
    // 帯とパネルが同時に出た状態になる。ここで同じ鍵を全部引き受ける。
    // Prec.high … 他の拡張 (補完・括弧) より先に見てもらう
    Prec.high(
      keymap.of([
        {
          key: "Mod-f",
          preventDefault: true,
          run: () => {
            hooks.onOpen(false);
            return true;
          },
        },
        {
          key: "Mod-h",
          preventDefault: true,
          run: () => {
            hooks.onOpen(true);
            return true;
          },
        },
        { key: "F3", run: () => hooks.onFindNext(), preventDefault: true },
        { key: "Mod-g", run: () => hooks.onFindNext(), preventDefault: true },
        {
          key: "Shift-F3",
          run: () => hooks.onFindPrev(),
          preventDefault: true,
        },
        {
          key: "Shift-Mod-g",
          run: () => hooks.onFindPrev(),
          preventDefault: true,
        },
        // 同じ語を次々と選ぶ (複数カーソル)。標準キーマップを切ったので
        // ここで拾い直す — パネルを開かないコマンドなので、そのまま使える
        { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
        { key: "Escape", run: () => hooks.onEscape() },
      ]),
    ),
  ];
}
