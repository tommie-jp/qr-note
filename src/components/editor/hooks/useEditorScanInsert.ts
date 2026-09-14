"use client";

import { useState } from "react";
import { insertBlock } from "@/lib/editor/cmDoc";
import {
  DemoDisabledError,
  fetchPrefillSummary,
  prefillTargetFromCode,
} from "@/lib/external/prefillSummary";
import { isTaggableCode, scanRegisterMemo } from "@/lib/external/scanRegister";
import type { EditorRef, SetEditorError } from "./types";

export interface EditorScanInsert {
  // カメラのモーダルを開いているか
  scanning: boolean;
  // 読み取り後の取得中 (フォーム送信を止める)
  scanBusy: boolean;
  // 取得中・結果の知らせ (OCR と同じ赤バナー)
  scanNote: string | null;
  openScanner: () => void;
  closeScanner: () => void;
  runScanInsert: (rawValue: string) => Promise<void>;
}

// 編集中スキャン (docs/13/14 の書誌・商品情報を挿入する導線)。
//
// バーコードを読んで書籍・商品情報をカーソル位置へ挿入する
// (検索・遷移はしない。ユーザー要望)。ISBN→書誌、JAN→商品情報を引き、
// 取れれば scanRegisterMemo で見出し+タグを、取れなくてもタグだけを挿す。
// 書籍・商品コードでなければ、タグにできれば #コード、無理なら生値を入れる。
export function useEditorScanInsert({
  editorRef,
  setError,
}: {
  editorRef: EditorRef;
  setError: SetEditorError;
}): EditorScanInsert {
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  const runScanInsert = async (rawValue: string) => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const code = rawValue.trim();
    setError(null);
    setScanNote(null);
    view.focus();

    const target = prefillTargetFromCode(code);
    if (!target) {
      // 書籍・商品として引けないコード。タグにできれば #コード、それ以外は生値
      insertBlock(view, isTaggableCode(code) ? scanRegisterMemo(code).trim() : code);
      return;
    }

    const noun = target.kind === "book" ? "書籍情報" : "商品情報";
    setScanBusy(true);
    setScanNote(`${noun}を取得中…`);
    try {
      const summary = await fetchPrefillSummary(target);
      // 取れても取れなくてもコード自体は入れる (見つからなくても手掛かりが残る)
      insertBlock(view, scanRegisterMemo(code, summary).trim());
      setScanNote(
        summary ? null : `${noun}が見つかりませんでした。コードだけ挿入しました。`,
      );
    } catch (e) {
      // 取得に失敗してもコード (タグ) だけは入れておく
      insertBlock(view, scanRegisterMemo(code).trim());
      setScanNote(
        e instanceof DemoDisabledError
          ? `デモ版では${noun}を取得できません。コードだけ挿入しました。`
          : `${noun}の取得に失敗しました。コードだけ挿入しました。`,
      );
    } finally {
      setScanBusy(false);
    }
  };

  return {
    scanning,
    scanBusy,
    scanNote,
    openScanner: () => setScanning(true),
    closeScanner: () => setScanning(false),
    runScanInsert,
  };
}
