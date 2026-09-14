"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  DemoDisabledError,
  fetchPrefillSummary,
  type PrefillKind,
  type PrefillTarget,
} from "@/lib/external/prefillSummary";
import { scanRegisterMemo } from "@/lib/external/scanRegister";
import { useLatest } from "../hooks/useLatest";

// 型は取得ロジックと同じ場所 (prefillSummary) に置いた。従来ここから import して
// いた箇所 (MemoEditor) のために再輸出する
export type { PrefillKind, PrefillTarget };

// 取得の途中経過。文言は呼び出し側 (MemoEditor) が決める。
//   idle     … 取得対象ではない (取得しない)
//   loading  … 取得中
//   loaded   … 取得して本文に入れた
//   skipped  … 取得できたが、打ち始めていたので入れなかった
//   notFound … どの API にも無かった
//   error    … 通信・サーバの失敗
//   demoDisabled … デモインスタンスで取得を無効にしている (docs/39 §5)
export type PrefillStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "skipped"
  | "notFound"
  | "error"
  | "demoDisabled";

interface PrefillOptions {
  // 新規登録するコードが ISBN / JAN のときだけ渡す
  target?: PrefillTarget;
  // いまの本文 (打ち始めたかの判定に使う)
  value: string;
  // 「まだ何も書いていない」ことを表す本文
  pristine: string;
  setMemo: Dispatch<SetStateAction<string>>;
}

// ISBN / JAN をスキャンして開いた新規ノートに、書誌・商品情報を流し込む。
//
// target が undefined のとき (既存ノート・対象外のコード・手打ちの編集) は
// 何もしない。
export function usePrefill({
  target,
  value,
  pristine,
  setMemo,
}: PrefillOptions): PrefillStatus {
  // 最初の描画から「取得中」を出す。effect (取得開始) を待って出すと、
  // 一瞬だけ無表示になるうえ、effect の中で同期に setState することになる。
  //
  // target はこのコンポーネントが生きている間は変わらない (URL から来て、
  // 別のノートを開けばページごと作り直される) ので、初期値だけで足りる。
  // defaultValue に対する MemoEditor の前提と同じ
  const [status, setStatus] = useState<PrefillStatus>(target ? "loading" : "idle");

  // いまの本文を effect から読むための控え。value を effect の依存に入れると
  // 打鍵のたびに取得がやり直しになるため、依存には入れずここで拾う
  const valueRef = useLatest(value);

  // 依存はオブジェクトの identity ではなく中身 (kind / code) で持つ。
  // 親の再描画で毎回新しいオブジェクトが渡されても取得をやり直さない
  const kind = target?.kind;
  const code = target?.code;
  useEffect(() => {
    if (!kind || !code) {
      return;
    }
    const abort = new AbortController();
    fetchPrefillSummary({ kind, code }, abort.signal)
      .then((summary) => {
        if (!summary) {
          // どの API にも無かった。事前入力のままにして手で書いてもらう
          // (導線は止めない)
          setStatus("notFound");
          return;
        }
        // 取得を待つ間に打ち始めていたら書き換えない。遅れて返ってきた内容が
        // 手書きを消すのがこの機能で最悪の事故
        if (valueRef.current !== pristine) {
          setStatus("skipped");
          return;
        }
        setMemo(scanRegisterMemo(code, summary));
        setStatus("loaded");
      })
      .catch((err) => {
        if (abort.signal.aborted) {
          return; // ページを離れただけ
        }
        // デモは失敗ではないので、専用の status にして専用文言を出す
        if (err instanceof DemoDisabledError) {
          setStatus("demoDisabled");
          return;
        }
        // 握り潰さずに残す (UI にも status で出る)
        console.warn("書誌・商品情報の取得に失敗しました", err);
        setStatus("error");
      });
    return () => abort.abort("unmount");
  }, [kind, code, setMemo, pristine, valueRef]);

  return status;
}
