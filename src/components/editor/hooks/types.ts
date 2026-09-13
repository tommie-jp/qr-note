import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { RefObject } from "react";

// 編集画面のフック (MemoEditorInner から分けたもの) が共有する型。
//
// view は @uiw/react-codemirror が作ってから ref に入る。**マウント直後の
// effect ではまだ undefined** なので (memory「マウント時 effect の dispatch は
// 捨てられる」)、どのフックもイベント・非同期処理の時点で読み直す
export type EditorRef = RefObject<ReactCodeMirrorRef | null>;

// エディタ直下の赤いエラー欄。null で畳む
export type SetEditorError = (message: string | null) => void;
