"use client";

import { useEffect, useRef } from "react";
import { MEMO_BASELINE_EVENT } from "@/lib/editorEvents";

// フォームの内容を比較用の文字列にする。File は編集対象でないので捨てる
// (MemoEditorInner の画像選択 input は name を持たず、そもそも入ってこない)
function snapshot(form: HTMLFormElement): string {
  const entries = [...new FormData(form).entries()].filter(
    ([, value]) => typeof value === "string",
  );
  return JSON.stringify(entries);
}

// 未保存の変更があるまま離脱しようとしたら確認を出す
// (docs/11-アプリ的UIUX計画.md §2-2)。編集フォームの中に置いて使う。
//
// マウント時の内容 (= 保存済みの内容) を覚えておき、離脱時に今の内容と比べる。
// 「入力があったら dirty」方式と違い、書いて元に戻したときに誤って引き止めない。
// memo (CodeMirror) は hidden input が正本なので、これだけで本文も URL も mode も見る。
//
// 発火するのはページ本体の離脱 (タブを閉じる・リロード・アドレスバーからの移動)
// だけ。「更新」→ redirect やページ内リンクはクライアント遷移で beforeunload が
// 起きないため引き止めない (計画どおり Link のガードは見送り。保存は止まらない)。
export function UnsavedGuard() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = markerRef.current?.closest("form");
    if (!form) {
      return;
    }
    let saved = snapshot(form);

    // 競合バナーで本文をサーバ値へ揃え直したら、比較の基準も取り直す
    // (docs/87-編集競合対策計画.md §2-3)。取り直さないと、揃えただけで
    // 「未保存の変更がある」と引き止めてしまう
    const handleBaseline = () => {
      saved = snapshot(form);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (snapshot(form) === saved) {
        return;
      }
      // 確認ダイアログを出す (文面はブラウザ固定で指定できない)。
      // preventDefault が現行の作法だが、古い WebKit は returnValue しか
      // 見ないため両方を立てる
      event.preventDefault();
      event.returnValue = true;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    form.addEventListener(MEMO_BASELINE_EVENT, handleBaseline);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      form.removeEventListener(MEMO_BASELINE_EVENT, handleBaseline);
    };
  }, []);

  return <span ref={markerRef} hidden />;
}
