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
// **ブロック数式 ($$...$$) も同じ規則で追う** (下の blockMathRanges)。
// 全文への正規表現 1 発にはしない — 無関係な $$ 同士 (散文の $$、bash の
// echo $$) が対になって間の本文ごと数式にされるため、本文側と同じく
// **行単位**で開閉を追う。開きは行頭の $$ だけと見る (memoSummary の
// hiddenLineSkipper と同じ線引き)。
//
// コードの中を除けるのは編集画面の強み。一覧側は正規表現しか持たないので
// 行単位の状態機械でフェンスも一緒に追っているが、こちらは構文木に聞ける。

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
import { inlineMathRanges, SINGLE_LINE_BLOCK_MATH } from "@/lib/memoSummary";

export interface MathRange {
  start: number;
  end: number;
  tex: string;
  display: boolean;
}

// 行頭で始まるブロック数式の開き ($$ で始まる行)。
// **行頭だけを開きと見る**のが要点 — 散文の途中の $$ まで開きにすると、
// そこから次の $$ までの本文が丸ごと数式にされる
const BLOCK_MATH_OPEN = /^\s*\$\$/;

// 本文の中のブロック数式 ($$...$$) の範囲。行単位で開閉を追う。
//
// 1 行で閉じるもの ($$x$$) を先に取り、残りに $$ があれば行を跨ぐ対として
// 扱う (本文側 memoSummary の見方と同じ順序)。閉じないまま終わった対は
// 返さない — 書きかけの $$ で以降の本文が丸ごと消えないように
export function blockMathRanges(text: string): MathRange[] {
  const found: MathRange[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let openStart: number | null = null;

  for (const line of lines) {
    if (openStart === null) {
      // 1 行で閉じるものを拾う
      for (const m of line.matchAll(SINGLE_LINE_BLOCK_MATH)) {
        const start = offset + m.index;
        found.push({
          start,
          end: start + m[0].length,
          tex: m[0].slice(2, -2).trim(),
          display: true,
        });
      }
      // 残りに $$ があれば、そこから行を跨ぐ対が始まる
      const rest = line.replace(SINGLE_LINE_BLOCK_MATH, "");
      if (rest.includes("$$") && BLOCK_MATH_OPEN.test(rest)) {
        openStart = offset;
      }
    } else if (line.replace(SINGLE_LINE_BLOCK_MATH, "").includes("$$")) {
      // 閉じ。開きの行頭から閉じの行末までを 1 つの範囲にする
      const end = offset + line.length;
      const raw = text.slice(openStart, end);
      found.push({
        start: openStart,
        end,
        // 前後の $$ を落とす (開きの行頭と閉じの行末にある)
        tex: raw.replace(/^\s*\$\$/, "").replace(/\$\$\s*$/, "").trim(),
        display: true,
      });
      openStart = null;
    }
    offset += line.length + 1; // 改行のぶん
  }
  return found;
}

const PARSE_BUDGET_MS = 200;

// 組んだ HTML を数式の中身で覚える。カーソルが動くたびに組み直すので
// (選択の出入りが表示の合図)、毎回 KaTeX を通すと打鍵が重くなる
const htmlCache = new Map<string, string>();
const HTML_CACHE_MAX = 200;

// KaTeX が読めない式は null (生の `$...$` のまま見せる)。
// **エラーを投げさせない** — 書きかけの式は必ず途中で壊れているので、
// 打つたびに例外が飛ぶのは普通のこと
export function renderMathHtml(tex: string, display = false): string | null {
  // 同じ式でもインラインと別行では組み方が違うので、鍵に含める
  const key = `${display ? "d" : "i"}:${tex}`;
  const cached = htmlCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const html = katex.renderToString(tex, {
      ...KATEX_OPTIONS,
      displayMode: display,
      throwOnError: true,
    });
    if (htmlCache.size >= HTML_CACHE_MAX) {
      const oldest = htmlCache.keys().next();
      if (!oldest.done) {
        htmlCache.delete(oldest.value);
      }
    }
    htmlCache.set(key, html);
    return html;
  } catch {
    return null;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement(this.display ? "div" : "span");
    span.className = this.display ? "cm-qr-math cm-qr-math-block" : "cm-qr-math";
    // KaTeX が組んだ HTML (入力は本文の数式で、KaTeX 自身がエスケープする)
    span.innerHTML = renderMathHtml(this.tex, this.display) ?? "";

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

  // ブロック ($$) を先に取る。インラインの `$...$` はブロックの中にも
  // 見えてしまうので、ブロックが取った範囲は後から除く
  const blocks = blockMathRanges(doc);
  const inlines: MathRange[] = inlineMathRanges(doc)
    .filter(({ start, end }) => !blocks.some((b) => start < b.end && end > b.start))
    .map(({ start, end }) => ({
      start,
      end,
      // 前後の `$` を落とした中身
      tex: doc.slice(start + 1, end - 1),
      display: false,
    }));

  for (const { start, end, tex, display } of [...blocks, ...inlines]) {
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
    if (renderMathHtml(tex, display) === null) {
      continue; // 読めない式は生のまま (書きかけを消さない)
    }
    ranges.push(
      Decoration.replace({
        widget: new MathWidget(tex, display),
        // 行をまたぐ対はブロック装飾にしないと置き換えられない
        block: display && doc.slice(start, end).includes("\n"),
      }).range(start, end),
    );
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
