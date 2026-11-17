"use client";

import type { ViewUpdate } from "@codemirror/view";
import { useCallback, type RefObject } from "react";
import { useLatest } from "@/components/hooks/useLatest";
import type { EditToolbarEditor } from "@/components/editor/EditToolbar";
import { busyReason, isEditorBusy } from "@/lib/editor/busyReason";
import {
  ocrButtonLabel,
  recordButtonLabel,
  uploadButtonLabel,
} from "@/lib/progress/progressLabels";
import type { EditorRef, SetEditorError } from "./types";
import {
  type DropInto,
  type InsertFiles,
  useAttachmentInsert,
} from "./useAttachmentInsert";
import { useDropZone } from "./useDropZone";
import { useEditorClipboard } from "./useEditorClipboard";
import { useEditorCommands } from "./useEditorCommands";
import { useEditorDrawing } from "./useEditorDrawing";
import { useEditorExtensions } from "./useEditorExtensions";
import { useEditorHistory } from "./useEditorHistory";
import { type EditorOcr, useEditorOcr } from "./useEditorOcr";
import { useEditorRecordings } from "./useEditorRecordings";
import { useEditorScanInsert } from "./useEditorScanInsert";
import { useEditorSecret } from "./useEditorSecret";
import { useFenceGui } from "./useFenceGui";
import { useLivePreview } from "./useLivePreview";
import { useNoteFind } from "./useNoteFind";
import { useOcrOnInsert } from "./useOcrOnInsert";
import { useSubmitBlocker } from "./useSubmitBlocker";

// MemoEditorInner が繋ぐ機能のフック一式 (MemoEditorInner から分けた)。
// **呼ぶ順は分ける前と同じ** — effect の走る順がフックの呼び順で決まるため

interface FeatureDeps {
  editorRef: EditorRef;
  setError: SetEditorError;
}

type ToolDeps = FeatureDeps & {
  insertFiles: InsertFiles;
  dropInto: DropInto;
  fileEvents: Parameters<typeof useEditorExtensions>[0]["fileEvents"];
  hostEl: HTMLElement | null;
};

// 挿入のあとに並ぶ機能。前半 (ドロップ・録音・取り込み・スキャン) と
// 後半 (シークレット・図・拡張・プレビュー・検索・履歴・お絵かき・書式) を
// この順に呼ぶ
export function useEditorTools(deps: ToolDeps) {
  const inputs = useInputTools(deps);
  const views = useViewTools(deps);
  return { ...inputs, ...views };
}

function useInputTools({ editorRef, setError, insertFiles, dropInto }: ToolDeps) {
  const dropZone = useDropZone({ editorRef, dropInto });
  const { recording, videoRecording, isRecording } = useEditorRecordings({
    editorRef,
    setError,
    insertFiles,
  });
  const clipboard = useEditorClipboard({ editorRef, setError, insertFiles });
  const scan = useEditorScanInsert({ editorRef, setError });
  return { dropZone, recording, videoRecording, isRecording, clipboard, scan };
}

function useViewTools({ editorRef, setError, insertFiles, fileEvents, hostEl }: ToolDeps) {
  const secrets = useEditorSecret({ editorRef });
  const fenceGui = useFenceGui({ editorRef, setError });
  const { extensions, livePreviewCompartment, noteSearch } =
    useEditorExtensions({ fileEvents });
  const preview = useLivePreview({
    editorRef,
    compartment: livePreviewCompartment,
  });
  const find = useNoteFind({
    editorRef,
    noteSearch,
    hostEl,
    setLivePreviewSuspended: preview.setLivePreviewSuspended,
  });
  const history = useEditorHistory({ editorRef });
  const drawings = useEditorDrawing({ editorRef, setError, insertFiles });
  const commands = useEditorCommands({ editorRef, setError });
  return { secrets, fenceGui, extensions, preview, find, history, drawings, commands };
}

export type EditorTools = ReturnType<typeof useEditorTools>;

// アップロード / OCR / 録音・録画の完了前に送信すると、画像リンクや OCR 結果、
// 録音・録画そのものが memo に入らないため、処理中だけフォーム送信をブロックして知らせる
export function useEditorBusy({
  wrapperRef,
  setError,
  uploading,
  ocr,
  tools,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>;
  setError: SetEditorError;
  uploading: boolean;
  ocr: EditorOcr;
  tools: EditorTools;
}): { busy: boolean; submitForm: () => void } {
  const busyState = {
    isRecording: tools.isRecording,
    uploading,
    scanBusy: tools.scan.scanBusy,
    clipboardBusy: tools.clipboard.clipboardBusy,
    // 全画像 OCR は 1 枚の合間 (次の画像の取得中) に ocrCount が 0 に戻る。
    // その隙に「更新」が通らないよう、走っている間ずっと止める
    ocrRunning: ocr.ocrCount > 0 || ocr.ocrAll !== null,
  };
  const busy = isEditorBusy(busyState);
  const { submitForm } = useSubmitBlocker({
    wrapperRef,
    reason: busy ? busyReason(busyState) : null,
    onBlocked: setError,
  });
  return { busy, submitForm };
}

// CodeMirror の onUpdate。**参照を固定する** — CodeMirror はこの関数の参照が
// 変わると拡張一式を組み直す (BASIC_SETUP のコメント参照)。
// 渡す 4 つはどれも参照が変わらない (各フックの useCallback([]))
export function useEditorUpdate(tools: EditorTools): (update: ViewUpdate) => void {
  const { trackHistory } = tools.history;
  const { trackFindUpdate } = tools.find;
  const { trackSecretLabel } = tools.secrets;
  const { trackFenceGui } = tools.fenceGui;
  return useCallback(
    (update: ViewUpdate) => {
      trackHistory(update);
      trackFindUpdate(update);
      trackSecretLabel(update);
      trackFenceGui(update);
    },
    [trackHistory, trackFindUpdate, trackSecretLabel, trackFenceGui],
  );
}

// 挿入した画像の OCR とその切り替え、添付の挿入。ocrOnInsert は ref で渡す
// (挿入の処理が走る時点の設定を読む)
function useEditorOcrInsert({ editorRef, setError }: FeatureDeps) {
  const ocr = useEditorOcr({ editorRef, setError });
  const { ocrOnInsert, toggleOcrOnInsert } = useOcrOnInsert();
  const ocrOnInsertRef = useLatest(ocrOnInsert);
  return { ocr, ocrOnInsert, toggleOcrOnInsert, ocrOnInsertRef };
}

// 録音の釦。録音中だけは busy でも押せる。止められないと録音が終わらない
function recordButton(
  recording: EditorTools["recording"],
  busy: boolean,
): EditToolbarEditor["record"] {
  return {
    label: recordButtonLabel(recording.isRecording, recording.elapsedMs),
    isRecording: recording.isRecording,
    disabled: busy && !recording.isRecording,
    toggle: recording.toggle,
  };
}

// OCR のメニュー (この画像 / ノートの全画像、docs/106 §2)
function ocrMenu(ocr: EditorOcr): EditToolbarEditor["ocr"] {
  return {
    label: ocrButtonLabel(ocr.ocrCount),
    runAtCursor: () => void ocr.runOcrAtCursor(),
    runAll: () => void ocr.runOcrForAll(),
    countAll: ocr.countImagesWithoutOcr,
    all: ocr.ocrAll,
    cancelAll: ocr.cancelOcrAll,
  };
}

// 下部バーのツールバーが描く・呼ぶもの (EditToolbarEditor)。
// 進捗は progressLabels のラベル文字列にしてから渡す
export function editorToolbar({
  submitForm,
  busy,
  upload,
  uploading,
  openFilePicker,
  ocr,
  ocrOnInsert,
  toggleOcrOnInsert,
  tools,
}: {
  submitForm: () => void;
  busy: boolean;
  upload: Parameters<typeof uploadButtonLabel>[0];
  uploading: boolean;
  openFilePicker: () => void;
  ocr: EditorOcr;
  ocrOnInsert: boolean;
  toggleOcrOnInsert: () => void;
  tools: EditorTools;
}): EditToolbarEditor {
  const { scan, secrets, preview, commands, find, fenceGui } = tools;
  return {
    submit: submitForm,
    busy,
    history: tools.history,
    upload: { label: uploadButtonLabel(upload), uploading, open: openFilePicker },
    pasteClipboard: tools.clipboard.importClipboard,
    scan: { label: scan.scanBusy ? "取得中" : "スキャン", open: scan.openScanner },
    record: recordButton(tools.recording, busy),
    recordVideo: tools.videoRecording.openPreview,
    draw: tools.drawings.openDrawing,
    ocr: ocrMenu(ocr),
    secret: { label: secrets.secretLabel, open: secrets.openSecret },
    ocrOnInsert: { on: ocrOnInsert, toggle: toggleOcrOnInsert },
    livePreview: { on: preview.livePreview, toggle: preview.toggleLivePreview },
    format: commands.applyFormat,
    addPage: () => void commands.addPage(),
    find: find.openFind,
    fenceGui: { enabled: fenceGui.canOpen, open: fenceGui.openFenceGui },
  };
}

// エディタの機能一式を繋ぎ、送信の止め・onUpdate・ツールバーまで組む。
// 呼ぶ順 (OCR → 添付 → 機能 → 送信の止め) は MemoEditorInner から分ける前と同じ
export function useEditorWiring({
  editorRef,
  wrapperRef,
  setError,
  hostEl,
}: FeatureDeps & {
  wrapperRef: RefObject<HTMLDivElement | null>;
  hostEl: HTMLElement | null;
}) {
  const { ocr, ocrOnInsert, toggleOcrOnInsert, ocrOnInsertRef } =
    useEditorOcrInsert({ editorRef, setError });
  // 戻り値は分けて受ける。fileInputRef (ref) と同じ入れ物のまま描画中に
  // 他の値を読むと、react-hooks/refs が「ref を描画中に読んだ」と見なす
  const {
    upload,
    uploading,
    insertFiles,
    fileEvents,
    dropInto,
    fileInputRef,
    openFilePicker,
    handleFilePick,
  } = useAttachmentInsert({
    editorRef,
    setError,
    ocrIntoDoc: ocr.ocrIntoDoc,
    ocrOnInsert: ocrOnInsertRef,
  });
  const tools = useEditorTools({ editorRef, setError, insertFiles, dropInto, fileEvents, hostEl });
  const { busy, submitForm } = useEditorBusy({ wrapperRef, setError, uploading, ocr, tools });
  const handleUpdate = useEditorUpdate(tools);
  const toolbar = editorToolbar({
    submitForm,
    busy,
    upload,
    uploading,
    openFilePicker,
    ocr,
    ocrOnInsert,
    toggleOcrOnInsert,
    tools,
  });
  return { ocr, tools, handleUpdate, toolbar, fileInputRef, handleFilePick };
}
