"use client";

import { useState } from "react";
import { imageAtCursor } from "@/lib/ocr/ocrQuote";
import type { InsertFiles } from "./useAttachmentInsert";
import type { EditorRef, SetEditorError } from "./types";

export interface EditorDrawing {
  // お絵かき画面。null なら閉じている。開くときにカーソルの近くの画像を控え、
  // 下敷きの候補として渡す (docs/34-お絵かき計画.md §2)
  drawing: { sourceImageUrl: string | null } | null;
  openDrawing: () => void;
  closeDrawing: () => void;
  insertDrawing: (file: File, alt: string) => void;
}

export function useEditorDrawing({
  editorRef,
  setError,
  insertFiles,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
  insertFiles: InsertFiles;
}): EditorDrawing {
  const [drawing, setDrawing] = useState<EditorDrawing["drawing"]>(null);

  // 「お絵かき」: カーソルの近くに自前画像があればそれを下敷きにして開く。
  // 「後から OCR」と同じ探し方 (imageAtCursor) なので、画像の上で押せば
  // その画像に描ける。下敷きが要らなければお絵かき画面で白紙に切り替えられる
  const openDrawing = () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    setError(null);
    const hit = imageAtCursor(
      view.state.doc.toString(),
      view.state.selection.main.head,
    );
    setDrawing({ sourceImageUrl: hit?.url ?? null });
  };

  // 描いたものは 1 枚の画像として、ファイル選択と同じ挿入経路に流す。
  // 元にした画像は書き換えない (描いたものは別の画像として増える)
  const insertDrawing = (file: File, alt: string) => {
    setDrawing(null);
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    view.focus();
    void insertFiles(view, [file], { imageAlt: alt, ocr: false });
  };

  return {
    drawing,
    openDrawing,
    closeDrawing: () => setDrawing(null),
    insertDrawing,
  };
}
