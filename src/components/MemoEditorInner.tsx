"use client";

import type { ViewUpdate } from "@codemirror/view";
import "@atomic-editor/editor/styles.css";
// ライブプレビューの数式 (mathBlocks.ts) が KaTeX の組んだ HTML を出すので、
// 編集画面でもその CSS が要る。閲覧側 (MarkdownView) とは別の入り口なので
// ここでも読み込む — 無いと数式が素の文字列として崩れて出る
import "katex/dist/katex.min.css";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import dynamic from "next/dynamic";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBottomBarSlot } from "@/components/BottomBarContext";
import { EditToolbar } from "@/components/EditToolbar";
import { PanelActiveContext } from "@/components/PanelActiveContext";
import { ACCEPTED_FILE_TYPES } from "@/lib/editor/attachmentKinds";
import { busyReason, isEditorBusy } from "@/lib/editor/busyReason";
import {
  ocrButtonLabel,
  recordButtonLabel,
  uploadButtonLabel,
} from "@/lib/progressLabels";
// 打ち止めと文字数表示は**サーバと同じ上限**を見る (別に持つと、編集画面が
// 止めているのにインポートは通る/その逆のずれ方をする)
import { MAX_TEXT_LENGTH } from "@/lib/validation";
import { NoteSearchBar } from "./editor/NoteSearchBar";
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
import { BusyNotice } from "./BusyNotice";
import { VideoRecordModal } from "./VideoRecordModal";

// fabric 一式は重いので、お絵かきを開くまで読み込まない
// (CodeMirror を遅延させているのと同じ流儀。MemoEditor.tsx 参照)
const DrawModal = dynamic(() => import("./draw/DrawModal"), {
  ssr: false,
  loading: () => null,
});

// スキャナ (カメラ + zxing wasm) も重いので、スキャンを押すまで読み込まない。
// 検索画面 (BottomActionBar) と同じ部品を、挿入モード (onResult) で使う
const ScannerModal = dynamic(
  () => import("./ScannerModal").then((m) => m.ScannerModal),
  { ssr: false, loading: () => null },
);

// シークレットの入力ダイアログ (docs/51-部分暗号化計画.md §8)。
// 開くまで読み込まない (暗号まわり一式を普段の編集に載せない)
const SecretDialog = dynamic(
  () => import("./secret/SecretDialog").then((m) => m.SecretDialog),
  { ssr: false, loading: () => null },
);

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
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {/* 自動停止の知らせ。押していないのに止まった理由が判らないと、
          録音が切れた原因を探せない */}
      {recording.note && (
        <BusyNotice aria-live="polite">{recording.note}</BusyNotice>
      )}
      {/* 録画は全画面モーダルで行う (プレビュー・録画・カメラ操作すべて)。
          state と操作は videoRecording が持ち、ここは開閉のきっかけだけ */}
      <VideoRecordModal video={videoRecording} />
      {videoRecording.note && (
        <BusyNotice aria-live="polite">{videoRecording.note}</BusyNotice>
      )}
      {ocr.ocrNote && (
        <BusyNotice
          aria-live="polite"
          aria-busy={ocr.ocrCount > 0}
          busy={ocr.ocrCount > 0}
        >
          {ocr.ocrNote}
          {/* % は aria-hidden で足す: aria-live が毎ティック読み上げないように */}
          {ocr.modelPercent !== null && (
            <span aria-hidden> {ocr.modelPercent}%</span>
          )}
        </BusyNotice>
      )}
      {/* 編集中スキャンの取得中・結果 (OCR と同じ赤バナー) */}
      {scan.scanNote && (
        <BusyNotice
          aria-live="polite"
          aria-busy={scan.scanBusy}
          busy={scan.scanBusy}
        >
          {scan.scanNote}
        </BusyNotice>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        hidden
        onChange={(e) => handleFilePick(e.target.files)}
      />
      {drawings.drawing && (
        <DrawModal
          sourceImageUrl={drawings.drawing.sourceImageUrl}
          onCancel={drawings.closeDrawing}
          onInsert={drawings.insertDrawing}
        />
      )}
      {/* シークレットの入力。**本文の state を経由しない** — ここで書いた
          平文は封をしてからでないと外へ出ない (docs/51 §8) */}
      {secrets.secret && (
        <SecretDialog
          name={secrets.secret.name}
          initialText={secrets.secret.text}
          initialLabel={secrets.secret.label}
          onSaved={secrets.applySecret}
          onClose={secrets.closeSecret}
        />
      )}
      {/* 編集中スキャン: 読み取った生値を runScanInsert へ渡すだけ (検索しない) */}
      {scan.scanning && (
        <ScannerModal
          title="書籍・商品バーコードをかざす"
          onClose={scan.closeScanner}
          onResult={(rawValue) => void scan.runScanInsert(rawValue)}
        />
      )}
      {/* 操作ボタンを下部バーの差し込み口へ portal する。差し込み口が出来る
          まで hostEl は null (表向きのタブでない間も null)。portal は React
          ツリーの親子を保つので、更新ボタンの useFormStatus は囲みの form を
          拾い、各ハンドラは上の state/ref を触れる。
          **検索中はツールバーの代わりに検索バーを出す** (docs/76 §2) —
          並べると帯が 2 段になり、狭い画面で本文が潰れる */}
      {hostEl &&
        find.findOpen &&
        createPortal(<NoteSearchBar {...find.barProps} />, hostEl)}
      {hostEl &&
        !find.findOpen &&
        createPortal(
          <EditToolbar
            onSubmit={submitForm}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
            uploadLabel={uploadButtonLabel(upload)}
            uploading={uploading}
            onInsertFile={openFilePicker}
            onPasteClipboard={clipboard.importClipboard}
            scanLabel={scan.scanBusy ? "取得中" : "スキャン"}
            onScan={scan.openScanner}
            recordLabel={recordButtonLabel(
              recording.isRecording,
              recording.elapsedMs,
            )}
            isRecording={recording.isRecording}
            // 録音中だけは busy でも押せる。止められないと録音が終わらない
            recordDisabled={busy && !recording.isRecording}
            onToggleRecord={recording.toggle}
            onRecordVideo={videoRecording.openPreview}
            onDraw={drawings.openDrawing}
            ocrLabel={ocrButtonLabel(ocr.ocrCount)}
            onOcr={() => void ocr.runOcrAtCursor()}
            secretLabel={secrets.secretLabel}
            onSecret={secrets.openSecret}
            livePreview={preview.livePreview}
            onToggleLivePreview={preview.toggleLivePreview}
            onFormat={commands.applyFormat}
            onAddPage={() => void commands.addPage()}
            onFind={find.openFind}
            busy={busy}
          />,
          hostEl,
        )}
    </div>
  );
}
