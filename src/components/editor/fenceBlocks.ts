// ライブプレビュー中、カーソルの無い ```mermaid フェンスを図として描く
// CodeMirror 拡張 (docs/70-編集ライブプレビュー計画.md §7)。
//
// テーブル (tableBlocks.ts) と同じ**読み取り専用**の作り — カーソルが入れば
// 生のフェンスに戻り、直すのは原文の上で行う。本文は書き換えない。
//
// **いまは mermaid だけ。** 同じフェンスの仲間でも出どころが違う:
//   - circuitikz / tikz … SVG はサーバ (node-tikzjax) が描いて props で渡る
//     (MarkdownView の CircuitMap)。編集画面にその結果は無く、取りに行く
//     API も無いので、ここでは描けない (別途エンドポイントが要る)
//   - quiz … 描くのは React 部品 (QuizFence)。widget の中で createRoot して
//     unmount まで面倒みる形になるので、mermaid が落ち着いてから
// どちらも生のフェンスのまま表示される (閲覧タブで見られるので困らない)。

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
import { MERMAID_LANG } from "@/lib/fenceLanguages";
import { mermaidRenderId, renderMermaidSvg } from "@/lib/mermaidRender";

const PARSE_BUDGET_MS = 200;

// 描画済みの SVG を本文の中身で覚える。畳む / 開くを繰り返すたびに
// mermaid を呼び直すと、そのつど数百 ms かかって図がちらつく
const svgCache = new Map<string, string>();

// 覚えすぎない (長いノートを開いて回ると際限なく積む)。
// 図は 1 つ数 KB なので、この程度なら抱えても軽い
const SVG_CACHE_MAX = 50;

function rememberSvg(code: string, svg: string): void {
  if (svgCache.size >= SVG_CACHE_MAX) {
    // いちばん古いものから捨てる (Map は挿入順を保つ)
    const oldest = svgCache.keys().next();
    if (!oldest.done) {
      svgCache.delete(oldest.value);
    }
  }
  svgCache.set(code, svg);
}

// widget ごとに違う DOM id を振るための連番 (mermaid が id を要求する)
let renderSeq = 0;

class MermaidFenceWidget extends WidgetType {
  // 描き終わる前に畳みが解かれたら、後から届く SVG を捨てるための印
  private live = true;

  constructor(readonly code: string) {
    super();
  }

  eq(other: MermaidFenceWidget): boolean {
    return other.code === this.code;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-qr-fence";

    const cached = svgCache.get(this.code);
    if (cached !== undefined) {
      // mermaid が securityLevel: "strict" でサニタイズ済み (閲覧側と同じ)
      wrap.innerHTML = cached;
    } else {
      wrap.textContent = "図を描画中…";
      wrap.classList.add("cm-qr-fence-busy");
      void this.draw(wrap);
    }

    // 押したら原文の先頭へカーソルを移す (チップ・表と同じ手)
    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(wrap);
      if (pos < 0) {
        return;
      }
      view.focus();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    });
    return wrap;
  }

  private async draw(wrap: HTMLElement): Promise<void> {
    try {
      const svg = await renderMermaidSvg(this.code, mermaidRenderId(`f${++renderSeq}`));
      rememberSvg(this.code, svg);
      if (!this.live) {
        return; // 描いている間に畳みが解かれた
      }
      wrap.classList.remove("cm-qr-fence-busy");
      wrap.innerHTML = svg;
    } catch (e) {
      if (!this.live) {
        return;
      }
      // 構文エラーは**隠さない**。図にならない理由が判らないと直せない
      wrap.classList.remove("cm-qr-fence-busy");
      wrap.classList.add("cm-qr-fence-error");
      wrap.textContent = `mermaid の構文エラー: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }
  }

  destroy(): void {
    this.live = false;
  }

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }
}

export function buildFenceBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const { from: selFrom, to: selTo, empty: isCursor } = state.selection.main;
  tree.iterate({
    enter: (node) => {
      if (node.name !== "FencedCode" || node.from >= node.to) {
        return;
      }
      // 表と同じ判定 (tableBlocks.ts に理由)
      const touching = isCursor
        ? selFrom >= node.from && selFrom <= node.to
        : selFrom < node.to && selTo > node.from;
      if (touching) {
        return;
      }
      const source = state.doc.sliceString(node.from, node.to);
      const code = mermaidFenceCode(source);
      if (code === null) {
        return;
      }
      ranges.push(
        Decoration.replace({
          widget: new MermaidFenceWidget(code),
          block: true,
        }).range(node.from, node.to),
      );
    },
  });
  return Decoration.set(ranges, true);
}

// ```mermaid フェンスなら中身のコードを返す。それ以外は null。
//
// 構文木ではなく原文で見るのは、開きの行 (```mermaid) と閉じの行を落として
// 「中身だけ」を取り出すのがそのほうが素直なため。フェンスの範囲そのものは
// 構文木が決めているので、ここで拾い間違えることはない
export function mermaidFenceCode(source: string): string | null {
  const lines = source.split("\n");
  const opening = /^\s*(?:`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[0]);
  if (!opening || opening[1].toLowerCase() !== MERMAID_LANG) {
    return null;
  }
  const body = lines.slice(1);
  // 閉じの行は落とす (途中で切れたフェンスには無いこともある)
  if (body.length > 0 && /^\s*(?:`{3,}|~{3,})\s*$/.test(body[body.length - 1])) {
    body.pop();
  }
  const code = body.join("\n").trim();
  return code.length > 0 ? code : null;
}

const fenceBlocksField = StateField.define<DecorationSet>({
  create: buildFenceBlocks,
  update(deco, tr) {
    return tr.docChanged || tr.selection ? buildFenceBlocks(tr.state) : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function fenceBlocks(): Extension {
  return fenceBlocksField;
}
