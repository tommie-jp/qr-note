// 本文 markdown の解釈を決める remark プラグイン列と、それで読むパーサ
// (docs/93-リファクタリング計画.md §4-10)。
//
// **描く側と構造を読む側で必ず同じ列を使う**ために、ここ 1 か所に置く。
// 描画は components/markdown/markdownPipeline.tsx (react-markdown に NOTE_REMARK_PLUGINS を渡す)、
// 構造を読むのは components/notepage/notePages.ts (ページの区切り。createNoteParser で読む)。
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
// このモジュールは "use client" も react も react-markdown も持たない葉に
// しておくこと — components/notepage/notePages.ts は編集画面 (editor/hooks/useEditorCommands.ts) からも読まれるので、
// components/markdown/markdownPipeline.tsx (react-markdown 一式) を経由させるとクライアントの束に
// それが降る。
//
// **この列で読んでいない抽出がまだ 3 本ある** (markdown/taskCheckbox.ts・health/healthRecords.ts
// は gfm だけ、extractFences.ts は素の remark-parse)。どれも数式や折りたたみ・
// 脚注の中で拾うノードがこの列と食い違う (`$$` の中のタスクやフェンス、脚注の
// 字下げの中のフェンス) ので、寄せると数え方・引き方が変わる。寄せるときは
// 挙動の変更として別に扱うこと。

import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified, type PluggableList } from 'unified'
import { remarkAlerts } from './remarkAlerts'
import { remarkDetails, remarkDetailsSyntax } from './remarkDetails'
import { remarkFootnotes } from './remarkFootnotes'

// **新しい記法のプラグインはここに足す** (docs/71 §4)。MarkdownView だけに
// 足すと、一覧のプレビューがその記法を生の文字のまま描く (逆も) ずれ方をする。
//
// 並びの約束: remarkDetails は **remarkBreaks より前** — 知らない directive を
// 原文の文字に戻すとき、戻した中の改行も他の本文と同じ改行として描かせるため
// (後ろに置くと 1 行に潰れて見える)
export const NOTE_REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkDetailsSyntax,
  remarkDetails,
  remarkBreaks,
  remarkMath,
  remarkAlerts,
]

// 描画と同じ列で本文を読むパーサ。凍結済みなので使い回してよい
// (呼ぶたびに組み直さず、モジュールの定数に持つ)。
//
// 構造を読むだけなら parse で足りる — 区切りも定義も構文の段階で決まる。
// ただしプラグインの登録は描画と同じにしておかないと、micromark 拡張を
// 持つもの (表・数式・折りたたみ) の読み方がずれる
export function createNoteParser() {
  return unified().use(remarkParse).use(NOTE_REMARK_PLUGINS).freeze()
}

// フェンスを拾うだけのパーサ (docs/122 §2)。描画の列の remark-gfm を、脚注だけを
// 読む remarkFootnotes に替える (表・打ち消し・自動リンク・タスクを外す)。
//
// 外した物はブロックの切れ目に関わらない。表は「空行か、別のブロック構文の始まり」
// で終わるので、フェンスは表があっても無くても同じ所で見つかる (表のセルの中の
// ``` はインラインのコード)。残りはインラインかリストの子。GFM の解析は本番の
// プロファイルで解析時間の約 16% を占め、外すと全ノートの解析が約 4 割縮んだ
// (docs/121 §11、docs/122 §2)。
//
// **脚注・math・details は外さない** — 脚注の定義の続き (字下げ 4 つ) のフェンスは
// 脚注の拡張が無いと字下げのコードになる。`$$` の中の ``` は数式の中身で、外すと
// フェンスに化ける。`:::` の中身は flow として解析されるので、外すと入れ子が読めない。
// 描画の parser と抽出が全ノート (手元と本番) で一致することは
// scripts/checkFenceParsers.ts で確かめた
export const FENCE_REMARK_PLUGINS: PluggableList = NOTE_REMARK_PLUGINS.map(
  (plugin) => (plugin === remarkGfm ? remarkFootnotes : plugin),
)

export function createFenceParser() {
  return unified().use(remarkParse).use(FENCE_REMARK_PLUGINS).freeze()
}
