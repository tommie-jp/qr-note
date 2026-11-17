"use client";

import { BUSY_NOTICE_CLASS, BUSY_SPINNER_CLASS } from "../ui";
import type { PrefillKind, PrefillStatus } from "./usePrefill";

// 取得は数秒かかることがあり (実機で確認)、無表示だと
// 「取得に失敗した」と見分けられない。取得中と結果をここで知らせる
// (docs/13-書誌自動取得計画.md §4)。
// 文言は種別で変える。JAN の取得中に「書籍情報」と出すと本を探しているように読める
const PREFILL_NOUN: Record<PrefillKind, string> = {
  book: "書籍情報",
  product: "商品情報",
};

// デモインスタンスの取得無効メッセージ (docs/39-デモ公開計画.md §5)。
// product は取得中などの noun (「商品情報」) と違い「JAN 情報」と呼ぶ —
// デモでは外部キーが無く、そもそも JAN で引けないことを直接伝えるため。
//
// **book はデモでも取れるようになった** (docs/45-デモ書誌開放計画.md) ので、
// サーバは書籍で demoDisabled を返さず、この book の文言は通常は出ない。
// 将来デモで書誌を再び閉じたときに正しい文言が出るよう、防御的に残す。
const PREFILL_DEMO_MESSAGE: Record<PrefillKind, string> = {
  book: "デモ版では書籍情報を取得できません",
  product: "デモ版では JAN 情報を取得できません",
};

function prefillMessage(kind: PrefillKind, status: PrefillStatus): string {
  const noun = PREFILL_NOUN[kind];
  const messages: Record<PrefillStatus, string> = {
    idle: "",
    loading: `${noun}を取得中…`,
    // 成功したときは書名・商品名が本文に出るので、文言では言わない
    loaded: "",
    skipped: `${noun}を取得しましたが、編集中のため反映していません`,
    notFound: `${noun}が見つかりませんでした`,
    error: `${noun}の取得に失敗しました`,
    demoDisabled: PREFILL_DEMO_MESSAGE[kind],
  };
  return messages[status];
}

// 取得の状況。min-h で 1 行ぶんの高さを確保し、文言が消えるときに
// エディタが動かないようにする (打っている最中に入力欄がずれない)。
// 取得中 (= 時間のかかる準備) だけは赤背景バナーで目立たせる。取得は
// ページを開いた直後に走るので、解消時の高さ変化が打鍵とぶつかることはない
export function PrefillNotice({ kind, status }: { kind: PrefillKind; status: PrefillStatus }) {
  const message = prefillMessage(kind, status);
  const isLoading = status === "loading";
  return (
    <p
      // 後から届く知らせなので、読み上げにも伝える
      aria-live="polite"
      aria-busy={isLoading}
      className={
        isLoading
          ? `${BUSY_NOTICE_CLASS} flex items-center gap-2`
          : `flex min-h-6 items-center gap-2 ${
              status === "error" ? "text-red-700" : "text-gray-500"
            }`
      }
    >
      {isLoading && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
      {message}
    </p>
  );
}
