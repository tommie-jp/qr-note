"use client";

import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { replaceToken } from "@/lib/editor/cmDoc";
import { errorText } from "@/lib/errorMessage";
import {
  type ImageAtCursor,
  imageAtCursor,
  imagesWithoutOcr,
  ocrInsertion,
  ocrPlaceholder,
} from "@/lib/ocr/ocrQuote";
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

// 1 枚の OCR の結末。全画像 OCR が「次へ進むか・止めるか」を決めるのに使う。
//   quoted  … 引用を差し込んだ
//   empty   … 文字が無かった (引用は付かない)
//   noImage … 画像を取り直せなかった
//   failed  … OCR そのものが失敗した (モデルの読み込みなど)
export type OcrOutcome = "quoted" | "empty" | "noImage" | "failed";

export interface OcrAllProgress {
  done: number;
  // 読み終えた枚数 + 今の本文に残っている対象。走っている間に画像が
  // 足されれば増える (最初に数えた値で固定すると done が total を超える)
  total: number;
  // 中止を押した後、読んでいる 1 枚を読み終えるまでの間
  cancelling: boolean;
}

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
  ) => Promise<OcrOutcome>;
  runOcrAtCursor: () => Promise<void>;
  // 「ノートの全画像を OCR」(docs/106-OCR切替と全画像OCR計画.md §2)。
  // まだ OCR の引用が付いていない自前画像を、1 枚ずつ直列に読む
  runOcrForAll: () => Promise<void>;
  // 今の本文で全画像 OCR の対象になる枚数 (メニューの表示用)
  countImagesWithoutOcr: () => number;
  // 全画像 OCR の進み具合 (走っていなければ null)
  ocrAll: OcrAllProgress | null;
  // 全画像 OCR を止める。読んでいる 1 枚は最後まで読み、残りを捨てる
  cancelOcrAll: () => void;
}

// 自前画像を取り直す (保存後のバイトを読む。理由は useAttachmentInsert の
// fetchImageBlob と同じ — HEIC などは保存時に WebP へ変換済み)
async function fetchOwnImage(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`画像を取得できませんでした (HTTP ${res.status})`);
  }
  return res.blob();
}

// 全画像 OCR の対象のうち、まだ試していないもの (本文の順)。
//
// 試して引用が付かなかった画像 (文字なし・取得失敗) は本文に残るので、
// 数えて飛ばす。**URL ではなく出現の回数で飛ばす** — 同じ画像を 2 か所に
// 貼ったノートで、1 か所目を読んだら 2 か所目まで飛ばさないように。
// 引用が付かなかった出現は、同じ URL の中で本文の前のほうに並ぶ (前から
// 読むので)。だから「その URL の先頭から n 個」を飛ばせば足りる
function pendingImages(
  doc: string,
  unquoted: ReadonlyMap<string, number>,
): ImageAtCursor[] {
  const seen = new Map<string, number>();
  return imagesWithoutOcr(doc).filter((image) => {
    const index = seen.get(image.url) ?? 0;
    seen.set(image.url, index + 1);
    return index >= (unquoted.get(image.url) ?? 0);
  });
}

// 編集画面の OCR (docs/24-画像OCR計画.md)。挿入した画像の OCR と
// 「後から OCR」ボタン、全画像 OCR (docs/106)、モデル読み込みの進捗と
// 後始末を持つ
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
  const [ocrAll, setOcrAll] = useState<OcrAllProgress | null>(null);
  // 中止の合図。ループが各周の頭で見る (state だと周の途中で古い値を読む)
  const cancelAllRef = useRef(false);
  // 全画像 OCR が走っているか。二重に起こさない門番は ref で持つ —
  // state だと、続けて 2 回押したとき両方が描き直し前の null を読んで通る
  const runningAllRef = useRef(false);

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
      // 全画像 OCR の残りも捨てる。続けると、落としたばかりの Worker と
      // wasm ヒープを次の 1 枚がまた立ち上げる (iOS の上限で落ちる元)
      cancelAllRef.current = true;
      disposeOcr("編集画面を離脱");
    };
  }, []);

  // 画像 1 枚を OCR し、指定位置へ引用ブロックを差し込む。挿入時 OCR と
  // 「後から OCR」と全画像 OCR がこの 1 本を使う (docs/24-画像OCR計画.md §4)。
  // 処理中はプレースホルダを置き、本文が編集されても文字列一致で差し替える。
  const ocrIntoDoc = async (
    view: EditorView,
    // Blob を直接、または後から届く Promise で受ける。プレースホルダは
    // insertPos が新鮮なうちに同期で挿し、画像取得の await はその後に回す
    // (取得を待つ間に本文が動いても、置換は文字列一致なのでずれない)
    source: Blob | Promise<Blob | null>,
    insertPos: number,
  ): Promise<OcrOutcome> => {
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
        return "noImage";
      }
      const quote = await ocrImageToQuote(blob);
      if (quote) {
        replaceToken(view, placeholder, quote);
        setOcrNote(null);
        return "quoted";
      }
      // 0 文字は黙って消さない。プレースホルダごと除いて理由を出す
      replaceToken(view, insertion, "");
      setOcrNote("画像から文字が見つかりませんでした。");
      return "empty";
    } catch (e) {
      replaceToken(view, insertion, "");
      setError(errorText(e));
      // 「準備しています…」を畳む。残すとエラーと並んで
      // 「まだ待てば直る」と誤解される (実機で確認)
      setOcrNote(null);
      return "failed";
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
    // 取得は待たずに渡す。待ってから位置を使うと、その間の打鍵で位置がずれる
    // (ocrIntoDoc が Promise を受けるのはこのため)。取得の失敗も ocrIntoDoc が出す
    await ocrIntoDoc(view, fetchOwnImage(hit.url), hit.insertAt);
  };

  const countImagesWithoutOcr = () => {
    const view = editorRef.current?.view;
    return view ? imagesWithoutOcr(view.state.doc.toString()).length : 0;
  };

  // 1 枚ずつ直列に読む。**1 枚ごとに今の本文から次の対象を選び直す** —
  // 読んでいる間に本文が編集されると、最初に控えた位置はずれる
  const runOcrForAll = async () => {
    const view = editorRef.current?.view;
    if (!view || runningAllRef.current) {
      return;
    }
    setError(null);
    setOcrNote(null);
    const unquoted = new Map<string, number>();
    const pending = () => pendingImages(view.state.doc.toString(), unquoted);
    if (pending().length === 0) {
      setOcrNote("OCR していない画像はありません。");
      return;
    }
    runningAllRef.current = true;
    cancelAllRef.current = false;
    let done = 0;
    try {
      for (let rest = pending(); rest.length > 0; rest = pending()) {
        if (cancelAllRef.current) {
          setOcrNote(`残り ${rest.length} 枚の OCR を中止しました。`);
          return;
        }
        const total = done + rest.length;
        setOcrAll((prev) => ({
          done,
          total,
          cancelling: prev?.cancelling ?? false,
        }));
        const image = rest[0];
        // 取得の失敗は 1 枚だけのこと (消された画像・通信の瞬断)。知らせて次へ
        const blob = fetchOwnImage(image.url).catch((e: unknown) => {
          setError(errorText(e));
          return null;
        });
        const outcome = await ocrIntoDoc(view, blob, image.insertAt);
        done += 1;
        if (outcome === "failed") {
          // OCR そのものが失敗した (モデルを読めない等)。次の画像でも同じ所で
          // 落ちるので、残りを読みに行かない。理由は ocrIntoDoc が出している
          return;
        }
        if (outcome !== "quoted") {
          unquoted.set(image.url, (unquoted.get(image.url) ?? 0) + 1);
        }
      }
    } finally {
      runningAllRef.current = false;
      setOcrAll(null);
    }
  };

  const cancelOcrAll = () => {
    cancelAllRef.current = true;
    setOcrAll((prev) => (prev === null ? null : { ...prev, cancelling: true }));
  };

  return {
    ocrCount,
    modelPercent,
    ocrNote,
    ocrIntoDoc,
    runOcrAtCursor,
    runOcrForAll,
    countImagesWithoutOcr,
    ocrAll,
    cancelOcrAll,
  };
}
