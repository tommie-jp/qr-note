// 本文 markdown の解釈を決める remark プラグイン列。
//
// **描く側と構造を読む側で必ず同じ列を使う**ために、ここ 1 か所に置く。
// 描画は markdownPipeline.tsx (BASE_REMARK_PLUGINS として再輸出)、
// 構造を読むのは notePages.ts (ページの区切り)。
//
// 分けて持っていたときは、描画側に remark-gfm と remark-math を足しても
// notePages 側が付いてこず、**同じ本文が画面とページ分割で違う形に読まれた**:
//
//   - 表の直後の `---` … 描画側は水平線 (ページが割れる) だが、gfm 無しでは
//     表がただの段落に見えるので `---` が setext 見出しの下線になり、
//     書いたページ区切りが黙って無視される
//   - ブロック数式の中の `---` … 描画側は数式 1 つ (割れない) だが、math
//     無しでは水平線に見えるので数式の途中で割れ、1 ページ目が閉じていない
//     `$$` で終わって以降の本文が消える
//
// このモジュールは "use client" も react も持たない葉にしておくこと —
// notePages.ts は編集画面 (MemoEditorInner) からも読まれるので、
// markdownPipeline.tsx (react-markdown 一式) を経由させると
// クライアントの束にそれが降る。

import type { PluggableList } from "unified";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkAlerts } from "./remarkAlerts";
import { remarkDetails, remarkDetailsSyntax } from "./remarkDetails";

// **新しい記法のプラグインはここに足す** (docs/71 §4)。MarkdownView だけに
// 足すと、一覧のプレビューがその記法を生の文字のまま描く (逆も) ずれ方をする。
//
// 並びの約束: remarkDetails は **remarkBreaks より前** — 知らない directive を
// 原文の文字に戻すとき、戻した中の改行も他の本文と同じ改行として描かせるため
// (後ろに置くと 1 行に潰れて見える)
export const BASE_REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkDetailsSyntax,
  remarkDetails,
  remarkBreaks,
  remarkMath,
  remarkAlerts,
];
