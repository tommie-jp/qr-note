// ライブプレビュー中に画像記法を「添付チップ」として行の下に描く CodeMirror
// 拡張 (docs/70-編集ライブプレビュー計画.md §5)。
//
// **@atomic-editor/editor の imageBlocks の代わり**に使う。あちらは `![](url)` を
// 素の <img> にするが、この本文の画像記法は画像専用ではない — 音声・動画・
// PDF・テキストの添付とシークレットが相乗りしている (経緯は lib/attachmentChip.ts)。
// 一方 inlinePreview は記法の生文字を隠してしまうので、代わりを描かないと
// 添付が消えたように見える。両者の隙間を埋めるのがこの拡張。
//
// block widget は ViewPlugin からは出せない (CodeMirror の制約: ブロック装飾は
// StateField か必須 facet 由来でなければならない) ので StateField で持つ。

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { attachmentChip } from "@/lib/attachmentChip";

// 構文解析を本文の最後まで進めるときの上限 (ms)。CodeMirror は既定では
// 画面に見えている範囲までしか解析しないため、これを待たずに組むと
// 下のほうの添付だけチップにならない。本文上限は 32,000 字
// (lib/validation.ts の MAX_TEXT_LENGTH) なので実際は一瞬で終わり、
// この値まで待つことはまず無い
const PARSE_BUDGET_MS = 200;

// 画像記法 1 つを丸ごと切り出して alt と url を取る。lezer の木を部品ごとに
// 歩くより読みやすく、外れたときは黙って描かない (壊れた記法は生のまま見せる
// ほうが直しやすい)。`![alt](url "title")` の形にも当てる
const IMAGE_NOTATION_RE = /^!\[([^\]]*)\]\(([^\s)"']+)(?:\s+["'][^)]*["'])?\)$/;

class AttachmentChipWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  // 同じ添付なら DOM を作り直さない。作り直すと画像がちらつき、
  // iOS では慣性スクロールが途切れる
  eq(other: AttachmentChipWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = attachmentChip(this.src, this.alt);
    const wrap = document.createElement("div");
    wrap.className = "cm-qr-attachment";
    wrap.dataset.kind = chip.kind;

    // 画像は実物を小さく出す。**箱の大きさは固定**にして、読み込みの前後で
    // 行の高さを動かさない (レイアウトがずれると打鍵中に文字が飛び、
    // iOS では慣性スクロールが止まる)。実寸で見たいときは markdown タブがある
    if (chip.thumbnailUrl !== null) {
      const img = document.createElement("img");
      img.className = "cm-qr-attachment-thumb";
      img.src = chip.thumbnailUrl;
      img.alt = "";
      img.loading = "lazy";
      wrap.appendChild(img);
    } else {
      const glyph = document.createElement("span");
      glyph.className = "cm-qr-attachment-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = chip.glyph;
      wrap.appendChild(glyph);
    }

    const label = document.createElement("span");
    label.className = "cm-qr-attachment-label";
    label.textContent = chip.label;
    wrap.appendChild(label);

    // チップを押したら記法の行へカーソルを移す (押せば生記法が出て直せる)。
    // **自前で移す必要がある** — side: 1 の block widget に対する CodeMirror の
    // 既定は「いちばん近い端」で、それは記法のある行ではなく**次の行の先頭**。
    // posAtDOM で widget の位置を引き、1 つ戻って記法の行に着地させる
    const onPointer = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtDOM(wrap);
      if (pos < 0) {
        return;
      }
      view.focus();
      view.dispatch({
        selection: { anchor: Math.max(0, pos - 1) },
        scrollIntoView: false,
      });
    };
    wrap.addEventListener("mousedown", onPointer);
    return wrap;
  }

  // CodeMirror 自身のマウス処理を止め、カーソルの行き先を上の onPointer に
  // 一本化する (両方が動くと、押した直後に既定の位置へ持っていかれる)
  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }
}

export function buildAttachmentBlocks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  tree.iterate({
    enter: (node) => {
      if (node.name !== "Image" || node.from >= node.to) {
        return;
      }
      const match = IMAGE_NOTATION_RE.exec(
        state.doc.sliceString(node.from, node.to),
      );
      if (!match) {
        return;
      }
      const [, alt, src] = match;
      if (!src) {
        return;
      }
      const line = state.doc.lineAt(node.from);
      ranges.push(
        Decoration.widget({
          widget: new AttachmentChipWidget(src, alt),
          block: true,
          // side: 1 で行の内容の**後ろ**に置く (チップが記法の下に出る)
          side: 1,
        }).range(line.to),
      );
    },
  });
  return Decoration.set(ranges, true);
}

// 本文が変わるたびに組み直す。差分で済ませる工夫 (変更行に `![` があるか等)
// はしていない — 本文は 10,000 字が上限で、全文を歩いても十分軽いため。
// 先に複雑にするより、素直な作りのままにしておく
const attachmentBlocksField = StateField.define<DecorationSet>({
  create: buildAttachmentBlocks,
  update(deco, tr) {
    return tr.docChanged ? buildAttachmentBlocks(tr.state) : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function attachmentBlocks(): Extension {
  return attachmentBlocksField;
}
