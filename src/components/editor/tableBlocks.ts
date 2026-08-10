// ライブプレビュー中、カーソルの無いテーブルを表として描く CodeMirror 拡張
// (docs/70-編集ライブプレビュー計画.md §7)。
//
// **読み取り専用**。カーソルが入れば生の markdown に戻り、そこで直接直す。
// セルを contenteditable にして本文へ書き戻す道 (@atomic-editor/editor の
// tables) は採らない — 書き戻しのたびに寄せが潰れ、テーブル全体が整形し
// なおされる (経緯は lib/markdownTable.ts の冒頭)。
//
// 添付チップ (attachmentBlocks.ts) との違いは、**選択に応じて出し入れする**
// こと。あちらは記法が inlinePreview に隠されるので常に出すが、こちらは
// 隠す側も自分なので「カーソルが入ったら装飾ごと畳んで原文を見せる」を
// 自分で面倒みる必要がある。ゆえに update は選択の変化でも組み直す。

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
import { parseMarkdownTable, type CellAlign } from "@/lib/markdownTable";

// attachmentBlocks と同じ理由 (画面外の表も描くため全文まで解析を進める)
const PARSE_BUDGET_MS = 200;

const ALIGN_STYLE: Record<Exclude<CellAlign, null>, string> = {
  left: "left",
  center: "center",
  right: "right",
};

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  // 原文が同じなら DOM を作り直さない
  eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-qr-table";
    const table = document.createElement("table");
    const model = parseMarkdownTable(this.source);
    if (!model) {
      // ここには来ない (描く前に読めたものだけ渡す) が、読めないものを
      // 空の表として見せるくらいなら原文をそのまま出す
      wrap.textContent = this.source;
      return wrap;
    }

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    model.header.forEach((cell, index) => {
      const th = document.createElement("th");
      th.textContent = cell;
      applyAlign(th, model.aligns[index]);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of model.rows) {
      const tr = document.createElement("tr");
      row.forEach((cell, index) => {
        const td = document.createElement("td");
        // **中身は文字としてそのまま置く。** セルの中の記法 (太字・リンク) は
        // 描かない — ここで markdown を解釈し始めると、本文の描画規則
        // (markdownPipeline の sanitize やリンクの rel) をもう 1 つ持つことに
        // なる。表の形が判れば編集の助けとしては足りる
        td.textContent = cell;
        applyAlign(td, model.aligns[index]);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);

    // 押したら原文の先頭へカーソルを移す (押せばそのまま直せる)。
    // 位置は widget 自身から引く — 本文が動いても正しい場所に当たる
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

  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }
}

function applyAlign(cell: HTMLTableCellElement, align: CellAlign): void {
  if (align !== null) {
    cell.style.textAlign = ALIGN_STYLE[align];
  }
}

export function buildTableBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const { from: selFrom, to: selTo, empty: isCursor } = state.selection.main;
  tree.iterate({
    enter: (node) => {
      if (node.name !== "Table" || node.from >= node.to) {
        return;
      }
      // **カーソル (や選択) が触れている表は畳まない。** 触れている間は
      // 原文が見えていないと直せない。
      //
      // カーソル (選択なし) と範囲選択で判定を変えているのは意図的:
      //   - カーソルは**両端を含めて**中と見る。表の先頭に居るとき、次に
      //     打った文字は表に入るので、原文が見えていないと直せない。
      //   - 範囲選択は端が接するだけなら外と見る。隣の段落を選んだだけで
      //     表が原文に戻ると、選択のたびに画面が跳ねる。
      const touching = isCursor
        ? selFrom >= node.from && selFrom <= node.to
        : selFrom < node.to && selTo > node.from;
      if (touching) {
        return;
      }
      const source = state.doc.sliceString(node.from, node.to);
      if (!parseMarkdownTable(source)) {
        return; // 読めない表は原文のまま見せる (直しやすい)
      }
      ranges.push(
        Decoration.replace({
          widget: new TableWidget(source),
          block: true,
        }).range(node.from, node.to),
      );
    },
  });
  return Decoration.set(ranges, true);
}

// **選択が動いたときも組み直す** (docChanged だけでは足りない) —
// カーソルが表に入った / 出たことが、そのまま出し入れの合図だから
const tableBlocksField = StateField.define<DecorationSet>({
  create: buildTableBlocks,
  update(deco, tr) {
    return tr.docChanged || tr.selection ? buildTableBlocks(tr.state) : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function tableBlocks(): Extension {
  return tableBlocksField;
}
