"use client";

import type { EditorView } from "@codemirror/view";
import { useEffect, useState } from "react";
import { replaceToken } from "@/lib/editor/cmDoc";
import { errorText } from "@/lib/errorMessage";
import { imageAtCursor, ocrInsertion, ocrPlaceholder } from "@/lib/ocr/ocrQuote";
import {
  disposeOcr,
  isOcrReady,
  MODEL_READY_PERCENT,
  ocrImageToQuote,
  subscribeModelProgress,
} from "@/components/ocr/ocrService";
import type { EditorRef, SetEditorError } from "./types";

// プレースホルダの一意性のための連番 (インスタンス間で共有してよい)
let ocrSeq = 0;

export interface EditorOcr {
  // 実行中の OCR の本数 (複数画像を続けて OCR できる)。0 より大きい間は
  // 「OCR処理中」を出し、フォーム送信を止める (結果が本文に入る前に更新しない)。
  ocrCount: number;
  // 初回のモデルダウンロードの実測 % (完了・待機中は null)
  modelPercent: number | null;
  // OCR の情報表示 (エラーではない「準備中」「見つかりませんでした」など)。
  // 初回はモデル取得で待ちが長く、灰色だと埋もれて「固まった」と誤解される
  // ため、画像検索の準備中バナーと同じ赤背景で目立たせる (ImageSearchModal)。
  ocrNote: string | null;
  ocrIntoDoc: (
    view: EditorView,
    source: Blob | Promise<Blob | null>,
    insertPos: number,
  ) => Promise<void>;
  runOcrAtCursor: () => Promise<void>;
}

// 編集画面の OCR (docs/24-画像OCR計画.md)。挿入した画像の OCR と
// 「後から OCR」ボタン、モデル読み込みの進捗と後始末を持つ
export function useEditorOcr({
  editorRef,
  setError,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
}): EditorOcr {
  const [ocrCount, setOcrCount] = useState(0);
  const [modelPercent, setModelPercent] = useState<number | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);

  // モデルダウンロードの % をバナーに流す。100 (初期化完了) でクリアする
  useEffect(() => {
    return subscribeModelProgress((percent) => {
      setModelPercent(percent >= MODEL_READY_PERCENT ? null : percent);
    });
  }, []);

  // 編集画面を離れたら OCR の Worker を落とす。抱えたままだと OpenCV と
  // onnxruntime の wasm ヒープが残り、後から開いた画像検索がモデルを積めずに
  // 落ちる (iOS WebKit のタブ上限)。terminate は realm ごと捨てるので
  // メモリが OS へ返る (ocrService.disposeOcr)
  useEffect(() => {
    return () => {
      disposeOcr("編集画面を離脱");
    };
  }, []);

  // 画像 1 枚を OCR し、指定位置へ引用ブロックを差し込む。挿入時 OCR と
  // 「後から OCR」ボタンの両方がこの 1 本を使う (docs/24-画像OCR計画.md §4)。
  // 処理中はプレースホルダを置き、本文が編集されても文字列一致で差し替える。
  const ocrIntoDoc = async (
    view: EditorView,
    // Blob を直接、または後から届く Promise で受ける。プレースホルダは
    // insertPos が新鮮なうちに同期で挿し、画像取得の await はその後に回す
    // (取得を待つ間に本文が動いても、置換は文字列一致なのでずれない)
    source: Blob | Promise<Blob | null>,
    insertPos: number,
  ) => {
    const seq = ++ocrSeq;
    const placeholder = ocrPlaceholder(seq);
    const insertion = ocrInsertion(placeholder);
    view.dispatch({ changes: { from: insertPos, insert: insertion } });
    setOcrCount((n) => n + 1);
    // モデルが載っていなければ読み込みが走る。処理中との区別を出す。
    // 「初回のみ」とは言えない: 画面を離れるとモデルを解放する (disposeOcr) ので、
    // 戻ってきた 2 回目以降もここを通る
    setOcrNote(isOcrReady() ? null : "OCR モデルを準備しています…");
    try {
      const blob = source instanceof Blob ? source : await source;
      if (!blob) {
        // 画像を取り直せなかった。OCR はおまけなので黙って諦める
        // (アップロードは成功していて画像自体は本文に載っている)
        replaceToken(view, insertion, "");
        setOcrNote(null);
        return;
      }
      const quote = await ocrImageToQuote(blob);
      if (quote) {
        replaceToken(view, placeholder, quote);
        setOcrNote(null);
      } else {
        // 0 文字は黙って消さない。プレースホルダごと除いて理由を出す
        replaceToken(view, insertion, "");
        setOcrNote("画像から文字が見つかりませんでした。");
      }
    } catch (e) {
      replaceToken(view, insertion, "");
      setError(errorText(e));
      // 「準備しています…」を畳む。残すとエラーと並んで
      // 「まだ待てば直る」と誤解される (実機で確認)
      setOcrNote(null);
    } finally {
      setOcrCount((n) => n - 1);
    }
  };

  // 「後から OCR」: カーソル位置にいちばん近い自前画像を取り直して OCR する。
  // 既にある画像 (過去にアップロード済み) を後から検索対象にできる (docs/24 §4)。
  const runOcrAtCursor = async () => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    setError(null);
    setOcrNote(null);
    const doc = view.state.doc.toString();
    const hit = imageAtCursor(doc, view.state.selection.main.head);
    if (!hit) {
      setOcrNote(
        "カーソルの近くに画像が見つかりません。画像の上を選んでから押して下さい。",
      );
      return;
    }
    try {
      const res = await fetch(hit.url);
      if (!res.ok) {
        throw new Error(`画像を取得できませんでした (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      await ocrIntoDoc(view, blob, hit.insertAt);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return { ocrCount, modelPercent, ocrNote, ocrIntoDoc, runOcrAtCursor };
}
