"use client";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, type Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
import {
  createLivePreviewCompartment,
  livePreviewContent,
} from "@/components/editor/livePreview";
import {
  createNoteSearch,
  type NoteSearchController,
} from "@/components/editor/noteSearchHighlight";
import { quizLinter } from "@/components/editor/quizLinter";
import { fenceLanguageCompletion } from "@/components/fenceCompletion";
import { fenceLanguageLinter } from "@/components/fenceLinter";
import { loadLivePreviewPref } from "@/lib/prefs/livePreview";
import { browserStorage } from "@/lib/prefs/storagePref";
// 打ち止めと文字数表示は**サーバと同じ上限**を見る (別に持つと、編集画面が
// 止めているのにインポートは通る/その逆のずれ方をする)
import { MAX_TEXT_LENGTH } from "@/lib/validation";

// CodeMirror に渡す設定はレンダリングごとに作り直さない。
// @uiw/react-codemirror は basicSetup / onUpdate の**参照**が変わるたびに
// StateEffect.reconfigure で拡張一式を組み直すため、毎回新しいオブジェクトを
// 渡すと打鍵のたびに全部が再構成される。録音中は 1 秒ごとに再レンダリングが
// 走るので、そのままだと再構成もその回数だけ起きる
export const BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  // 標準の検索キーマップは外す (docs/76-ノート内検索計画.md §3)。
  // Ctrl+F は自前の帯へ差し替えるが、F3 / Ctrl+G が残っていると、検索語が
  // 無いときに CodeMirror 標準のパネルが開いてしまう (帯と二重に出る)。
  // 同じ鍵は noteSearchExtension が全部引き受ける
  searchKeymap: false,
} as const;

export interface EditorExtensions {
  extensions: Extension[];
  livePreviewCompartment: Compartment;
  noteSearch: NoteSearchController;
}

// 拡張一式と、ライブプレビューの差し替え口を**一緒に**組む。
// Compartment をここで作るのは、拡張と寿命を揃えるため — 外で作って
// 配列の中から参照すると、拡張を組む useMemo の依存に載ってしまう
// (載せれば切り替えのたびに全再構成、載せなければ lint が鳴る)
//
// fileEvents (ペースト・ドロップ) は useAttachmentInsert が参照を固定して
// 渡すので、依存に載せても組み直しは起きない (編集画面につき一度だけ組む)
export function useEditorExtensions({
  fileEvents,
}: {
  fileEvents: Extension;
}): EditorExtensions {
  return useMemo(() => {
    const livePreviewCompartment = createLivePreviewCompartment();
    // 検索の拡張と、その呼び出し先の差し替え口。Compartment と同じ理由で
    // ここで作る — 拡張と寿命を揃え、中身だけを後から差し替える
    const noteSearch = createNoteSearch();
    // markdown() は内部で新しい言語インスタンスを作ってそこに組み込み補完を
    // 登録する。export される markdownLanguage は別インスタンスのため、
    // そちらに登録しても効かない (バンドル環境で languageDataAt に載らない)。
    // markdown() が返した当のインスタンス (md.language) に登録する。
    //
    // **base に markdownLanguage を渡して GFM を有効にする。**
    // 既定の base は CommonMark だけで、`- [ ] ` も `~~消し~~` も表 も
    // 構文木に出ない (TaskMarker / Strikethrough / Table のノードが無い)。
    // 本文の描画は remark-gfm で GFM として解釈している (markdownPipeline)
    // ので、エディタ側だけ CommonMark だと食い違う。
    //
    // これに気づいたのはライブプレビュー (docs/70) の実機確認 —
    // チェックボックスがウィジェットにならず、原因が構文木側だった。
    // 見えるところでは「装飾が付かない」形でしか出ないので気づきにくい
    const md = markdown({ base: markdownLanguage });
    const extensions = [
      md,
      // ```<言語> の補完 (basicSetup が autocompletion を既定で有効化済み)。
      // override せず language data 経由で登録し、組み込み補完と共存させる
      md.language.data.of({ autocomplete: fenceLanguageCompletion }),
      // circuitikz / mermaid の打ち間違いに警告を出す (補完だけでは
      // 入れ替わり誤字が無反応で確定してしまうため)
      fenceLanguageLinter,
      // ```quiz の中身の書き方 (docs/58 §2)。間違いに気づく場所が
      // 閲覧タブまで遠いので、編集中にその場で知らせる
      quizLinter,
      EditorView.lineWrapping,
      // 旧 textarea の maxLength 相当: 上限を超える変更を受け付けない
      EditorState.changeFilter.of((tr) => tr.newDoc.length <= MAX_TEXT_LENGTH),
      // ライブプレビューの差し込み口。中身の入れ替えは reconfigure で行い、
      // この配列の**参照は変えない** (参照が変わると拡張一式が組み直される)。
      //
      // **覚えてある設定はここで読む。** かつては常に OFF で組んでおいて
      // マウント時の effect で入れ直していたが、それでは効かなかった —
      // その時点では @uiw/react-codemirror がまだ view を作っておらず
      // (editorRef.current?.view が undefined)、dispatch が黙って捨てられる。
      // ボタンは ON の見た目なのに装飾が出ない、という形で出た (実機で確認)。
      // 拡張を組むこの場で読めば view の有無に関係なく最初から載り、
      // 一瞬だけ生記法が見える瞬間も無くなる。
      //
      // 描画中に localStorage を読むことになるが、この部品は ssr: false で
      // 読み込まれる (MemoEditor.tsx) ので hydration はずれない
      livePreviewCompartment.of(
        livePreviewContent(loadLivePreviewPref(browserStorage())),
      ),
      // ノート内検索 (docs/76 §3, §6)。検索状態・ハイライト・Ctrl+F を足す
      noteSearch.extension,
      // 添付のペースト・ドロップ (useAttachmentInsert)
      fileEvents,
    ];
    return { extensions, livePreviewCompartment, noteSearch };
  }, [fileEvents]);
}
