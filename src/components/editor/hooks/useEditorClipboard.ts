"use client";

import { useState } from "react";
import {
  clipboardFileName,
  clipboardReadErrorMessage,
  pickClipboardEntry,
} from "@/lib/clipboard/clipboardRead";
import { insertText } from "@/lib/editor/cmDoc";
import type { InsertFiles } from "./useAttachmentInsert";
import type { EditorRef, SetEditorError } from "./types";

export interface EditorClipboard {
  // クリップボードからの取り込み中か (docs/92-クリップボード連携計画.md §4)。
  // **読み取りの許可待ちも含める。** iOS は read() でペーストの吹き出しを出し、
  // 押されるまで返らない。その間に更新されると、取り込んだ画像が入る前の本文が
  // 保存され、後から挿入された記法だけが宙に浮く。二重押しもここで止まる
  clipboardBusy: boolean;
  importClipboard: () => void;
}

// 「貼り付け」: クリップボードの中身をそのまま取り込む
// (docs/92-クリップボード連携計画.md §4)。iPhone で写真をコピーしてから
// 押せば、編集画面を開いて本文を長押しする手順を省いて添付にできる。
export function useEditorClipboard({
  editorRef,
  setError,
  insertFiles,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
  insertFiles: InsertFiles;
}): EditorClipboard {
  const [clipboardBusy, setClipboardBusy] = useState(false);

  // **read() は同期のうちに呼ぶ。** 先に await を挟むとユーザー操作の扱いが
  // 切れ、NotAllowedError で弾かれる (clipboard/shareFile.ts の transient activation と
  // 同じ話)。iOS はここで「ペースト」の吹き出しを出し、そのタップが許可になる。
  //
  // 画像が無ければ文字を入れる — コピーしたものが画像でも文字でも、押す
  // ボタンは 1 つで済ませる (どちらが入っているかは押す前には分からない)
  const importClipboard = () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    setError(null);
    if (typeof navigator.clipboard?.read !== "function") {
      // secure context の外・対応していないブラウザ。ボタンは常に出しておき
      // (後から生えると帯が跳ねる)、押した時点で理由を言う
      setError("この環境ではクリップボードから取り込めません");
      return;
    }
    setClipboardBusy(true);
    const reading = navigator.clipboard.read();
    void (async () => {
      try {
        const pick = pickClipboardEntry(await reading);
        if (pick === null) {
          setError("クリップボードに画像も文字もありません");
          return;
        }
        const blob = await pick.entry.getType(pick.type);
        if (pick.kind === "text") {
          insertText(view, await blob.text());
          return;
        }
        // 上限を超えていれば縮めて送る (iOS の写真は PNG で 20〜30MB になる)
        const file = new File([blob], clipboardFileName(pick.type), {
          type: pick.type,
        });
        await insertFiles(view, [file], { shrinkOversized: true });
      } catch (e) {
        setError(clipboardReadErrorMessage(e));
      } finally {
        // 挿入まで待ってから下ろす。insertFiles も自前の busy (upload) を
        // 立てるので、取り込みの初めから終わりまで途切れずに塞がる
        setClipboardBusy(false);
      }
    })();
  };

  return { clipboardBusy, importClipboard };
}
