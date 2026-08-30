// ライブプレビュー中、カーソルの無い ```mermaid フェンスを図として描く
// CodeMirror 拡張 (docs/70-編集ライブプレビュー計画.md §7)。
//
// テーブル (tableBlocks.ts) と同じ**読み取り専用**の作り — カーソルが入れば
// 生のフェンスに戻り、直すのは原文の上で行う。本文は書き換えない。
//
// **描き方はフェンスの種類で違う。**
//   - mermaid … mermaid.render() がブラウザで SVG 文字列を返すので直接呼ぶ
//   - circuitikz … 描くのはサーバ (node-tikzjax)。閲覧はページを描くサーバが
//     先に済ませて props で渡すが、編集画面はその結果を持っていないので
//     /api/circuits に投げて受け取る (lib/circuitFetch.ts)
//   - quiz … 描くのは React 部品 (QuizFence)。widget の中で createRoot して
//     unmount まで面倒みる形になるので、まだ手を付けていない
// quiz は生のフェンスのまま表示される (閲覧タブで見られるので困らない)。

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
import {
  type CircuitLang,
  MERMAID_LANG,
  isCircuitLang,
} from "@/lib/fenceLanguages";
import { fetchCircuitSvg } from "@/lib/circuitFetch";
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

// 描ける種類。回路は 2 つの言語がそのまま種類になる (docs/91) —
// 描き方 (サーバに頼む) は同じでも、**どちらの言語として描くかを
// サーバへ伝える**必要があり、控えの鍵も分けないと取り違える
export type FenceKind = "mermaid" | CircuitLang;

class FenceWidget extends WidgetType {
  // 描き終わる前に畳みが解かれたら、後から届く SVG を捨てるための印
  private live = true;

  constructor(
    readonly kind: FenceKind,
    readonly code: string,
  ) {
    super();
  }

  eq(other: FenceWidget): boolean {
    return other.kind === this.kind && other.code === this.code;
  }

  toDOM(view: EditorView): HTMLElement {
    // 外箱と帯の二重構造。本文との間隔は外箱の padding で取る —
    // ウィジェット自身に縦 margin を付けると CodeMirror の高さ測定から
    // 漏れて、下の行のクリックとカーソル縦移動がずれる (globals.css の
    // .cm-qr-fence-box に経緯)
    const box = document.createElement("div");
    box.className = "cm-qr-fence-box";
    const wrap = document.createElement("div");
    wrap.className = "cm-qr-fence";
    box.appendChild(wrap);

    const cached = svgCache.get(this.cacheKey);
    if (cached !== undefined) {
      // mermaid が securityLevel: "strict" でサニタイズ済み (閲覧側と同じ)
      wrap.innerHTML = cached;
    } else {
      wrap.textContent = "図を描画中…";
      wrap.classList.add("cm-qr-fence-busy");
      void this.draw(wrap);
    }

    // 押したら原文の先頭へカーソルを移す (チップ・表と同じ手)
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(box);
      if (pos < 0) {
        return;
      }
      view.focus();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    });
    return box;
  }

  // 種類ごとに描き分ける。mermaid はブラウザで、circuitikz はサーバに頼む
  private get cacheKey(): string {
    return `${this.kind}:${this.code}`;
  }

  private async draw(wrap: HTMLElement): Promise<void> {
    const outcome =
      this.kind === "mermaid"
        ? await this.drawMermaid()
        : await this.drawCircuit(this.kind);

    if (!this.live) {
      return; // 描いている間に畳みが解かれた
    }
    wrap.classList.remove("cm-qr-fence-busy");
    if ("error" in outcome) {
      // 構文エラーは**隠さない**。図にならない理由が判らないと直せない
      wrap.classList.add("cm-qr-fence-error");
      wrap.textContent = outcome.error;
      return;
    }
    rememberSvg(this.cacheKey, outcome.svg);
    wrap.innerHTML = outcome.svg;
  }

  private async drawMermaid(): Promise<{ svg: string } | { error: string }> {
    try {
      const svg = await renderMermaidSvg(
        this.code,
        mermaidRenderId(`f${++renderSeq}`),
      );
      return { svg };
    } catch (e) {
      return {
        error: `mermaid の構文エラー: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // SVG はサーバが描いて検査済み (assertSafeCircuitSvg)。閲覧の
  // CircuitDiagram と同じものが同じ経路で届く
  private async drawCircuit(
    lang: CircuitLang,
  ): Promise<{ svg: string } | { error: string }> {
    return fetchCircuitSvg(this.code, lang);
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
      const fence = drawableFence(state.doc.sliceString(node.from, node.to));
      if (fence === null) {
        return;
      }
      ranges.push(
        Decoration.replace({
          widget: new FenceWidget(fence.kind, fence.code),
          block: true,
        }).range(node.from, node.to),
      );
    },
  });
  return Decoration.set(ranges, true);
}

// 描ける種類のフェンスなら種類と中身を返す。それ以外は null。
//
// 構文木ではなく原文で見るのは、開きの行 (```mermaid) と閉じの行を落として
// 「中身だけ」を取り出すのがそのほうが素直なため。フェンスの範囲そのものは
// 構文木が決めているので、ここで拾い間違えることはない
export function drawableFence(
  source: string,
): { kind: FenceKind; code: string } | null {
  const lines = source.split("\n");
  const opening = /^\s*(?:`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[0]);
  const lang = opening?.[1].toLowerCase();
  const kind: FenceKind | null =
    lang === MERMAID_LANG ? "mermaid" : isCircuitLang(lang) ? lang : null;
  if (kind === null) {
    return null;
  }
  const body = lines.slice(1);
  // 閉じの行は落とす (途中で切れたフェンスには無いこともある)
  if (body.length > 0 && /^\s*(?:`{3,}|~{3,})\s*$/.test(body[body.length - 1])) {
    body.pop();
  }
  const code = body.join("\n").trim();
  return code.length > 0 ? { kind, code } : null;
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
