"use client";

import "@atomic-editor/editor/styles.css";
// ライブプレビューの数式 (mathBlocks.ts) が KaTeX の組んだ HTML を出すので、
// 編集画面でもその CSS が要る。閲覧側 (MarkdownView) とは別の入り口なので
// ここでも読み込む — 無いと数式が素の文字列として崩れて出る
import "katex/dist/katex.min.css";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useBottomBarSlot } from "@/components/bottombar/BottomBarContext";
import { PanelActiveContext } from "@/components/editor/PanelActiveContext";
import { ACCEPTED_FILE_TYPES } from "@/lib/editor/attachmentKinds";
// 打ち止めと文字数表示は**サーバと同じ上限**を見る (別に持つと、編集画面が
// 止めているのにインポートは通る/その逆のずれ方をする)
import { MAX_TEXT_LENGTH } from "@/lib/validation";
import { EditorBanners } from "./EditorBanners";
import { EditorBottomBarPortal } from "./EditorBottomBarPortal";
import { EditorModals } from "./EditorModals";
import type { EditToolbarEditor } from "./EditToolbar";
import { type EditorTools, useEditorWiring } from "./hooks/useEditorFeatures";
import type { EditorOcr } from "./hooks/useEditorOcr";
import { BASIC_SETUP } from "./hooks/useEditorExtensions";

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

  const hostEl = useEditorHost(onReady);

  const { ocr, tools, handleUpdate, toolbar, fileInputRef, handleFilePick } =
    useEditorWiring({ editorRef, wrapperRef, setError, hostEl });
  const { dropZone } = tools;

  return (
    <div ref={wrapperRef} className="space-y-2" {...dropZone.handlers}>
      <EditorFrame dragging={dropZone.dragging}>
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          extensions={tools.extensions}
          autoFocus={autoFocus}
          minHeight={minHeight}
          placeholder="メモを入力して下さい。"
          basicSetup={BASIC_SETUP}
          onUpdate={handleUpdate}
        />
      </EditorFrame>
      {/* 操作ボタンは下部バーへ portal した (EditToolbar)。エディタ直下には
          文字数と補足だけを残す — バナー類 (エラー・録音/録画/OCR の知らせ) も
          打鍵中に見える本文の近くに置く */}
      <EditorFooter dragging={dropZone.dragging} length={value.length} />
      <EditorAccessories
        error={error}
        ocr={ocr}
        tools={tools}
        hostEl={hostEl}
        toolbar={toolbar}
        fileInputRef={fileInputRef}
        onFilePick={handleFilePick}
      />
    </div>
  );
}

// 下部バーの差し込み口を申告し、マウント時に読み込み済みを親へ知らせる
function useEditorHost(onReady: () => void): HTMLElement | null {
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

  // マウント時に一度だけ通知する。onReady は親が描くたびに作り直す関数なので、
  // effect event にして依存から外す (作り直しで撃ち直さない)
  const notifyReady = useEffectEvent(() => onReady());
  useEffect(() => {
    notifyReady();
  }, []);

  return hostEl;
}

// エディタの下に並ぶ物 (知らせ・file input・全画面の部品・下部バーの操作)
function EditorAccessories({
  error,
  ocr,
  tools,
  hostEl,
  toolbar,
  fileInputRef,
  onFilePick,
}: {
  error: string | null;
  ocr: EditorOcr;
  tools: EditorTools;
  hostEl: HTMLElement | null;
  toolbar: EditToolbarEditor;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFilePick: (files: FileList | null) => void;
}) {
  return (
    <>
      <EditorBanners
        error={error}
        recordingNote={tools.recording.note}
        videoRecordingNote={tools.videoRecording.note}
        ocr={ocr}
        scan={tools.scan}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        hidden
        onChange={(e) => onFilePick(e.target.files)}
      />
      <EditorModals
        videoRecording={tools.videoRecording}
        drawings={tools.drawings}
        secrets={tools.secrets}
        scan={tools.scan}
        fenceGui={tools.fenceGui}
      />
      <EditorBottomBarPortal hostEl={hostEl} find={tools.find} toolbar={toolbar} />
    </>
  );
}

// CodeMirror の枠。ドラッグ中は枠を青くして落とせる所を示す
function EditorFrame({ dragging, children }: { dragging: boolean; children: ReactNode }) {
  return (
    <div
      className={`overflow-hidden rounded border bg-white ${
        dragging ? "border-blue-500 ring-2 ring-blue-300" : "border-gray-300"
      }`}
    >
      {children}
    </div>
  );
}

// エディタ直下の補足と文字数
function EditorFooter({ dragging, length }: { dragging: boolean; length: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {/* ペースト・ドラッグ&ドロップは実質デスクトップの操作なので、
          幅が狭いときは畳む */}
      {dragging ? (
        <span className="font-bold text-blue-600">
          離すと挿入します
        </span>
      ) : (
        <span className="hidden text-gray-400 sm:inline">
          画像・音声・動画・PDF はペースト・ドラッグ&ドロップでも挿入できます
        </span>
      )}
      <span
        className={`ml-auto ${
          length >= MAX_TEXT_LENGTH ? "font-bold text-red-600" : "text-gray-400"
        }`}
      >
        {length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
      </span>
    </div>
  );
}
