"use client";

import type { ViewUpdate } from "@codemirror/view";
import "@atomic-editor/editor/styles.css";
// ライブプレビューの数式 (mathBlocks.ts) が KaTeX の組んだ HTML を出すので、
// 編集画面でもその CSS が要る。閲覧側 (MarkdownView) とは別の入り口なので
// ここでも読み込む — 無いと数式が素の文字列として崩れて出る
import "katex/dist/katex.min.css";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useBottomBarSlot } from "@/components/BottomBarContext";
import type { EditToolbarEditor } from "@/components/EditToolbar";
import { PanelActiveContext } from "@/components/PanelActiveContext";
import { ACCEPTED_FILE_TYPES } from "@/lib/editor/attachmentKinds";
import { busyReason, isEditorBusy } from "@/lib/editor/busyReason";
import {
  ocrButtonLabel,
  recordButtonLabel,
  uploadButtonLabel,
} from "@/lib/progress/progressLabels";
// 打ち止めと文字数表示は**サーバと同じ上限**を見る (別に持つと、編集画面が
// 止めているのにインポートは通る/その逆のずれ方をする)
import { MAX_TEXT_LENGTH } from "@/lib/validation";
import { EditorBanners } from "./editor/EditorBanners";
import { EditorBottomBarPortal } from "./editor/EditorBottomBarPortal";
import { EditorModals } from "./editor/EditorModals";
import { useAttachmentInsert } from "./editor/hooks/useAttachmentInsert";
import { useEditorClipboard } from "./editor/hooks/useEditorClipboard";
import { useEditorCommands } from "./editor/hooks/useEditorCommands";
import { useEditorDrawing } from "./editor/hooks/useEditorDrawing";
import {
  BASIC_SETUP,
  useEditorExtensions,
} from "./editor/hooks/useEditorExtensions";
import { useEditorHistory } from "./editor/hooks/useEditorHistory";
import { useEditorOcr } from "./editor/hooks/useEditorOcr";
import { useEditorRecordings } from "./editor/hooks/useEditorRecordings";
import { useEditorScanInsert } from "./editor/hooks/useEditorScanInsert";
import { useEditorSecret } from "./editor/hooks/useEditorSecret";
import { useLivePreview } from "./editor/hooks/useLivePreview";
import { useNoteFind } from "./editor/hooks/useNoteFind";
import { useSubmitBlocker } from "./editor/hooks/useSubmitBlocker";

export interface MemoEditorInnerProps {
  value: string;
  onChange: (value: string) => void;
  onReady: () => void;
  autoFocus?: boolean;
  minHeight?: string;
}

// markdown 用 CodeMirror エディタ本体 (制御コンポーネント)。
// 画像はペースト / ドラッグ&ドロップ / 画像ボタンで /api/images へアップロードし、
// カーソル位置に ![](url) を挿入する。
//
// 機能ごとの状態と操作は editor/hooks/ のフックが持ち、ここはそれを繋いで
// 描くだけ (docs/93-リファクタリング計画.md §5-1)
export default function MemoEditorInner({
  value,
  onChange,
  onReady,
  autoFocus = false,
  minHeight = "14rem",
}: MemoEditorInnerProps) {
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // タブパネル (MemoPanel) が hidden で保持する構成では、非表示タブでも
  // このコンポーネントはマウントされたまま。portal は hidden の枠を抜けて
  // 下部バーに残るので、表向きのタブのときだけ portal する (既定 true =
  // MemoPanel を通らない /edit ページでは常に表示扱い)
  const panelActive = useContext(PanelActiveContext);
  // 編集ボタンは下部バー (PageBottomBar) の差し込み口へ portal する。
  // portal は React ツリーの親子を保つので、囲みの <form> の子孫のまま —
  // useFormStatus (更新ボタン) が効き、onClick から下の state/ref も触れる。
  //
  // 帯は差し込む側がいるときだけ出るので、まず要ると申告する
  // (useBottomBarSlot)。口 (hostEl) が返るのは帯が描かれた次の描画から
  const hostEl = useBottomBarSlot(panelActive);

  useEffect(() => {
    onReady();
    // マウント時に一度だけ通知する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ocr = useEditorOcr({ editorRef, setError });
  // 戻り値は分けて受ける。fileInputRef (ref) と同じ入れ物のまま描画中に
  // 他の値を読むと、react-hooks/refs が「ref を描画中に読んだ」と見なす
  const {
    upload,
    uploading,
    insertFiles,
    fileEvents,
    fileInputRef,
    openFilePicker,
    handleFilePick,
  } = useAttachmentInsert({ editorRef, setError, ocrIntoDoc: ocr.ocrIntoDoc });
  const { recording, videoRecording, isRecording } = useEditorRecordings({
    editorRef,
    setError,
    insertFiles,
  });
  const clipboard = useEditorClipboard({ editorRef, setError, insertFiles });
  const scan = useEditorScanInsert({ editorRef, setError });
  const secrets = useEditorSecret({ editorRef });
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

  // アップロード / OCR / 録音・録画の完了前に送信すると、画像リンクや OCR 結果、
  // 録音・録画そのものが memo に入らないため、処理中だけフォーム送信をブロックして知らせる
  const busyState = {
    isRecording,
    uploading,
    scanBusy: scan.scanBusy,
    clipboardBusy: clipboard.clipboardBusy,
    ocrRunning: ocr.ocrCount > 0,
  };
  const busy = isEditorBusy(busyState);
  const { submitForm } = useSubmitBlocker({
    wrapperRef,
    reason: busy ? busyReason(busyState) : null,
    onBlocked: setError,
  });

  // CodeMirror の onUpdate。**参照を固定する** — CodeMirror はこの関数の参照が
  // 変わると拡張一式を組み直す (BASIC_SETUP のコメント参照)。
  // 渡す 3 つはどれも参照が変わらない (各フックの useCallback([]))
  const { trackHistory } = history;
  const { trackFindUpdate } = find;
  const { trackSecretLabel } = secrets;
  const handleUpdate = useCallback(
    (update: ViewUpdate) => {
      trackHistory(update);
      trackFindUpdate(update);
      trackSecretLabel(update);
    },
    [trackHistory, trackFindUpdate, trackSecretLabel],
  );

  // 下部バーのツールバーが描く・呼ぶもの (EditToolbarEditor)。
  // 進捗は progressLabels のラベル文字列にしてから渡す
  const toolbar: EditToolbarEditor = {
    submit: submitForm,
    busy,
    history,
    upload: {
      label: uploadButtonLabel(upload),
      uploading,
      open: openFilePicker,
    },
    pasteClipboard: clipboard.importClipboard,
    scan: {
      label: scan.scanBusy ? "取得中" : "スキャン",
      open: scan.openScanner,
    },
    record: {
      label: recordButtonLabel(recording.isRecording, recording.elapsedMs),
      isRecording: recording.isRecording,
      // 録音中だけは busy でも押せる。止められないと録音が終わらない
      disabled: busy && !recording.isRecording,
      toggle: recording.toggle,
    },
    recordVideo: videoRecording.openPreview,
    draw: drawings.openDrawing,
    ocr: {
      label: ocrButtonLabel(ocr.ocrCount),
      run: () => void ocr.runOcrAtCursor(),
    },
    secret: { label: secrets.secretLabel, open: secrets.openSecret },
    livePreview: {
      on: preview.livePreview,
      toggle: preview.toggleLivePreview,
    },
    format: commands.applyFormat,
    addPage: () => void commands.addPage(),
    find: find.openFind,
  };

  return (
    <div ref={wrapperRef} className="space-y-2">
      <div className="overflow-hidden rounded border border-gray-300 bg-white">
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          extensions={extensions}
          autoFocus={autoFocus}
          minHeight={minHeight}
          placeholder="メモを入力して下さい。"
          basicSetup={BASIC_SETUP}
          onUpdate={handleUpdate}
        />
      </div>
      {/* 操作ボタンは下部バーへ portal した (EditToolbar)。エディタ直下には
          文字数と補足だけを残す — バナー類 (エラー・録音/録画/OCR の知らせ) も
          打鍵中に見える本文の近くに置く */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {/* ペースト・ドラッグ&ドロップは実質デスクトップの操作なので、
            幅が狭いときは畳む */}
        <span className="hidden text-gray-400 sm:inline">
          画像・音声・動画・PDF はペースト・ドラッグ&ドロップでも挿入できます
        </span>
        <span
          className={`ml-auto ${
            value.length >= MAX_TEXT_LENGTH
              ? "font-bold text-red-600"
              : "text-gray-400"
          }`}
        >
          {value.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
        </span>
      </div>
      <EditorBanners
        error={error}
        recordingNote={recording.note}
        videoRecordingNote={videoRecording.note}
        ocr={ocr}
        scan={scan}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        hidden
        onChange={(e) => handleFilePick(e.target.files)}
      />
      <EditorModals
        videoRecording={videoRecording}
        drawings={drawings}
        secrets={secrets}
        scan={scan}
      />
      <EditorBottomBarPortal hostEl={hostEl} find={find} toolbar={toolbar} />
    </div>
  );
}
