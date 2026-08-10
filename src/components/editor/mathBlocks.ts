// ライブプレビュー中、カーソルの無いインライン数式 ($...$) を KaTeX で描く
// CodeMirror 拡張 (docs/70-編集ライブプレビュー計画.md §7)。
//
// テーブル・フェンスと同じ**読み取り専用**の作り — カーソルが触れれば生の
// `$...$` に戻り、直すのは原文の上で行う。本文は書き換えない。
//
// **見つけ方は本文と同じ 1 本を使う** (memoSummary.ts の INLINE_MATH)。
// 一覧の要約・プレビューと編集画面で「どこからどこまでが数式か」がずれると、
// 一覧では数式なのに編集では生の $ のまま、という食い違いが出る。
//
// **ブロック数式 ($$...$$) はまだ**。あちらは行を跨ぐ対で、本文側は行単位の
// 状態機械で追っている (memoSummary の fenceMathTracker) — 「隠す行を決める」
// ための道具で、範囲を返すようにはできていない。全文への正規表現 1 発に
// 置き換えると、無関係な $$ 同士 (散文の $$、bash の echo $$) が対になって
// 間の本文ごと数式にされる。生の $$ のまま出しても読めるので、急がない。

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import katex from "katex";
import { KATEX_OPTIONS } from "@/lib/katexOptions";
import { inlineMathRanges } from "@/lib/memoSummary";

const PARSE_BUDGET_MS = 200;

// 組んだ HTML を数式の中身で覚える。カーソルが動くたびに組み直すので
// (選択の出入りが表示の合図)、毎回 KaTeX を通すと打鍵が重くなる
const htmlCache = new Map<string, string>();
const HTML_CACHE_MAX = 200;

// KaTeX が読めない式は null (生の `$...$` のまま見せる)。
// **エラーを投げさせない** — 書きかけの式は必ず途中で壊れているので、
// 打つたびに例外が飛ぶのは普通のこと
export function renderMathHtml(tex: string): string | null {
  const cached = htmlCache.get(tex);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const html = katex.renderToString(tex, {
      ...KATEX_OPTIONS,
      displayMode: false,
      throwOnError: true,
    });
    if (htmlCache.size >= HTML_CACHE_MAX) {
      const oldest = htmlCache.keys().next();
      if (!oldest.done) {
        htmlCache.delete(oldest.value);
      }
    }
    htmlCache.set(tex, html);
    return html;
  } catch {
    return null;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-qr-math";
    // KaTeX が組んだ HTML (入力は本文の数式で、KaTeX 自身がエスケープする)
    span.innerHTML = renderMathHtml(this.tex) ?? "";

    // 押したら原文へカーソルを移す (チップ・表・図と同じ手)
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(span);
      if (pos < 0) {
        return;
      }
      view.focus();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    });
    return span;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }
}

// コード (フェンス・インラインコード) の中は数式にしない。
// `$` はシェルにも正規表現にも出るので、コードの中まで拾うと本文が化ける
const CODE_NODES = new Set([
  "FencedCode",
  "CodeText",
  "CodeBlock",
  "InlineCode",
]);

function codeRanges(state: EditorState): { from: number; to: number }[] {
  const tree =
    ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const ranges: { from: number; to: number }[] = [];
  tree.iterate({
    enter: (node) => {
      if (CODE_NODES.has(node.name)) {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });
  return ranges;
}

export function buildMathBlocks(state: EditorState): DecorationSet {
  const doc = state.doc.toString();
  const code = codeRanges(state);
  const { from: selFrom, to: selTo, empty: isCursor } = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  for (const { start, end } of inlineMathRanges(doc)) {
    // コードの中は数式として扱わない
    if (code.some((r) => start < r.to && end > r.from)) {
      continue;
    }
    // 表・図と同じ判定 (tableBlocks.ts に理由)
    const touching = isCursor
      ? selFrom >= start && selFrom <= end
      : selFrom < end && selTo > start;
    if (touching) {
      continue;
    }
    // 前後の `$` を落とした中身
    const tex = doc.slice(start + 1, end - 1);
    if (renderMathHtml(tex) === null) {
      continue; // 読めない式は生のまま (書きかけを消さない)
    }
    ranges.push(Decoration.replace({ widget: new MathWidget(tex) }).range(start, end));
  }
  return Decoration.set(ranges, true);
}

const mathBlocksField = StateField.define<DecorationSet>({
  create: buildMathBlocks,
  update(deco, tr) {
    return tr.docChanged || tr.selection ? buildMathBlocks(tr.state) : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function mathBlocks(): Extension {
  return mathBlocksField;
}
