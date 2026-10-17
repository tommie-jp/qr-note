"use client";

import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useRef, useState, type DragEvent, type RefObject } from "react";
import { insertText } from "@/lib/editor/cmDoc";
import { acceptsDrop, hasDroppedFiles } from "@/lib/editor/dropFiles";
import type { DropInto } from "./useAttachmentInsert";

export interface DropZone {
  // ファイルか URL を抱えたドラッグが編集画面の上にあるか (縁取りの表示用)
  dragging: boolean;
  handlers: {
    onDragEnter: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

// 編集画面のどこに落としても添付として受ける (docs/105-画像ドロップ計画.md §1)。
//
// 本文の上 (.cm-content) は CodeMirror の口 (useAttachmentInsert の
// fileEvents) が先に受けて preventDefault する。ここが受けるのはそれ以外 —
// 本文の下の余白・文字数の行・バナー、そして下部バーへ portal した
// ツールバー (React のイベントは portal を抜けて親へ伝わる)。
//
// **受けないと、Chrome / Edge は落としたファイルをタブで開く。** 編集画面が
// 消えて「ドロップが効かない」に見える (Windows でエクスプローラから引く形)
export function useDropZone({
  editorRef,
  dropInto,
}: {
  editorRef: RefObject<ReactCodeMirrorRef | null>;
  dropInto: DropInto;
}): DropZone {
  const [dragging, setDragging] = useState(false);
  // dragenter / dragleave は子要素を跨ぐたびに対で出る。数えて 0 に戻ったら外へ出た
  const depth = useRef(0);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrop(event.dataTransfer.types)) {
      return;
    }
    depth.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    // 本文の上で CodeMirror が既に受けているときも、ここで受け直してよい
    // (preventDefault は「落としてよい」の合図でしかない)
    if (!acceptsDrop(event.dataTransfer.types)) {
      return;
    }
    event.preventDefault();
    // ファイルは「写す」。URL は既定に任せる (本文内の添付画像を動かす
    // ドラッグも URL を載せるので、写すの印を出すと動きと食い違う)
    if (hasDroppedFiles(event.dataTransfer.types)) {
      event.dataTransfer.dropEffect = "copy";
    }
    // 対になる dragleave を取りこぼして消えた縁取りを、ここで出し直す
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!acceptsDrop(event.dataTransfer.types)) {
      return;
    }
    // relatedTarget が無い = ウィンドウの外へ出た。dragenter を受けた要素が
    // ドラッグ中に描き直されて消えると、その dragleave は来ないので数が狂う。
    // 外へ出たときは数えずに戻す
    if (event.relatedTarget === null) {
      reset();
      return;
    }
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) {
      setDragging(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    reset();
    // 本文の上は CodeMirror の口が処理済み (二重に入れない)
    if (event.defaultPrevented || !acceptsDrop(event.dataTransfer.types)) {
      return;
    }
    // ここで受けたものはどれも、ブラウザに任せるとページを離れる
    // (ファイルを開く・リンクへ移る)。入れられなくても止める
    event.preventDefault();
    const view = editorRef.current?.view;
    if (view === undefined) {
      return;
    }
    // 本文の外に落ちたので座標からは位置が引けない。今のカーソルに入れる
    if (dropInto(view, event.dataTransfer, null)) {
      return;
    }
    // 画像でないリンク。本文の上に落としたときと同じく文字で入れる
    const text = event.dataTransfer.getData("text/plain");
    if (text !== "") {
      insertText(view, text);
    }
  };

  return {
    dragging,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
