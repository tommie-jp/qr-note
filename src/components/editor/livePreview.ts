// 編集画面のライブプレビュー一式 (docs/70-編集ライブプレビュー計画.md)。
//
// カーソルの無い場所は記法 (`#` や `**`) を隠して装飾済みに見せ、カーソルが
// 入った場所だけ生の markdown に戻す。**本文は 1 バイトも書き換えない** —
// 装飾は CodeMirror の Decoration (表示層) だけで行うので、undo 履歴にも
// 下書き退避にも保存される本文にも影響しない。
//
// 土台は @atomic-editor/editor の inlinePreview (MIT)。同方式の実装を 3 つ
// 比べて選んだ経緯と、pre-1.0 につき exact pin する理由は計画 §3 に書いた。

import { Compartment, type Extension } from "@codemirror/state";
import { inlinePreview } from "@atomic-editor/editor";
import { attachmentBlocks } from "./attachmentBlocks";
import { tableBlocks } from "./tableBlocks";

// 拡張の入れ替え口。**配列ごと差し替えない**のが要点 —
// @uiw/react-codemirror は extensions の**参照**が変わるたびに拡張一式を
// 組み直すので (MemoEditorInner の BASIC_SETUP のコメント)、トグルのたびに
// エディタ全体が再構成されてしまう。Compartment なら参照を保ったまま
// 中身だけ入れ替えられる。
//
// **エディタ 1 つにつき 1 つ作る**こと。Compartment は「拡張ツリーの中の
// この場所」を指す印で、同じものを 2 つのエディタに挿すと入れ替えが混ざる
export function createLivePreviewCompartment(): Compartment {
  return new Compartment();
}

// ライブプレビューを構成する拡張。
//
// **inlinePreview 単体では使えない**: あれは非アクティブ行の `![alt](url)` を
// 丸ごと隠し、画像は imageBlocks が描く前提になっている。この本文では画像記法に
// 添付とシークレットが相乗りしているため imageBlocks は使えず、代わりに
// 自前の attachmentBlocks を組む (経緯は attachmentBlocks.ts)。この 2 つは
// 必ず対で入れる — 片方だけだと添付が消えるか、二重に描かれる。
//
// 組まないもの (@atomic-editor/editor は別 export なので単に呼ばない):
//   - tables … contenteditable のセルから本文へ**書き戻す**機能。書き戻しの
//     たびに寄せ (`:---:`) が潰れ、テーブル全体が整形しなおされるので採らない
//     (計画 §7)。代わりに読み取り専用の tableBlocks を自前で持つ
//   - wikiLinks / highlightMarkdown … `[[ ]]` と `==` はこの本文に無い記法。
//     入れると余計な解釈が増えるだけ
export function livePreviewExtension(): Extension {
  return [
    inlinePreview({
      // リンクを押したときの既定は window.open。ノートの URL が
      // 参照元として外へ漏れないよう、閲覧側 (markdownPipeline の
      // linkWithTarget) と同じく noopener/noreferrer を明示する
      onLinkClick: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
    }),
    attachmentBlocks(),
    // カーソルの無いテーブルを表として描く (読み取り専用。tableBlocks.ts)
    tableBlocks(),
  ];
}

// トグルの現在値から、Compartment に入れる中身を返す。
// OFF は空配列 = 装飾なし (従来のプレーンな編集表示そのもの)
export function livePreviewContent(enabled: boolean): Extension {
  return enabled ? livePreviewExtension() : [];
}
