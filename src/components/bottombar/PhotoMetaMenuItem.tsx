"use client";

import { useState } from "react";
import { PhotoMetaIcon } from "@/components/icons";
import { HEADER_MENU_ROW_CLASS } from "@/components/ui";
import type { PhotoMetaMode } from "@/lib/prefs/photoMeta";

// ハンバーガーメニューの「写真の撮影情報 (EXIF)」
// (docs/97-写真の撮影情報削除計画.md §4)。
//
// 添付した写真と動画の位置・日時・機種などを、保存するときに消すか残すかを選ぶ
// (動画は docs/97 §10。項目名は写真のまま — 利用者が決めた名前)。
// 既定は「消す」。**保存先はサーバ (user_settings)** — 消すかどうかは写真を
// 受けたサーバが決めるので、端末ごとに持つと PC と iPhone で食い違う。
//
// **保存に失敗したら選択を戻す。** 選択色 (RowTintMenuItem) は押した色を
// 当てたまま文言で知らせるが、こちらは見た目の好みではない。サーバは古い値の
// まま写真を扱うので、画面だけ「残す」を指していると次の写真で裏切られる。

const OPTIONS: ReadonlyArray<{ mode: PhotoMetaMode; label: string }> = [
  { mode: "strip", label: "消す" },
  { mode: "keep", label: "残す" },
];

const GROUP_LABEL = "写真の撮影情報 (EXIF)";

// 1 本の文字列で持つ。JSX の中で改行すると、日本語の途中に空白が入る
const DESCRIPTION =
  "写真と動画の位置・日時・機種など。「残す」にすると公開ノートからも読めます。" +
  "切り替えはこれから上げるものに効きます";

// 保存を諦めるまで。1 行を upsert するだけの口なので、これだけ待って
// 返らなければ電波か鯖の問題 (選択色と同じ)
const SAVE_TIMEOUT_MS = 10_000;

// このタブで保存できた値の控え。
//
// **メニューは閉じると行ごと捨てられる** (HeaderMenu は開いている間だけ中身を
// 描く)。開き直すと props の value から描き直すが、value は layout がページを
// 読み込んだときの値で、クライアント遷移では読み直されない。それを信じると
// 「残す」を保存した後に開き直したとき「消す」と出て、画面と実際が食い違う。
// そこで保存できた値をここに控え、value より優先する。
//
// モジュールの変数なのでサーバ描画でも存在するが、書くのはブラウザのクリック
// だけなので、サーバでは常に null のまま (他の人の値が混ざることはない)。
// ページを読み直せば layout が DB の値を読むので、控えは要らなくなる
let savedInThisTab: PhotoMetaMode | null = null;

// 控えを書く口はここだけ (描画の外。保存できたときのクリックからしか呼ばない)
function rememberSaved(mode: PhotoMetaMode | null): void {
  savedInThisTab = mode;
}

export function __setSavedPhotoMetaModeForTest(mode: PhotoMetaMode | null): void {
  rememberSaved(mode);
}

// 2 つで 1 組の切り替え。行の高さ (min-h-9) に収まるよう 32px にする
const OPTION_BUTTON_CLASS =
  "min-h-8 px-3 text-sm transition-colors disabled:opacity-60";

export function PhotoMetaMenuItem({ value }: { value: PhotoMetaMode }) {
  const [mode, setMode] = useState<PhotoMetaMode>(() => savedInThisTab ?? value);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const pick = async (next: PhotoMetaMode) => {
    if (next === mode) {
      return;
    }
    const previous = mode;
    setMode(next);
    setFailed(false);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/photo-meta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`保存に失敗しました (${response.status})`);
      }
      rememberSaved(next);
    } catch (error) {
      console.error("写真の撮影情報の設定を保存できませんでした:", error);
      setMode(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between`}
      // 行の中を押してもメニューを閉じない (選択色と同じ)
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex items-center gap-2">
        <PhotoMetaIcon />
        {GROUP_LABEL}
      </span>
      {/* radiogroup … 2 つで 1 つの値を選ぶ。button を並べただけだと
          読み上げが「いまどちらか」を言えない */}
      <span
        role="radiogroup"
        aria-label={GROUP_LABEL}
        className="flex shrink-0 overflow-hidden rounded border border-gray-300"
      >
        {OPTIONS.map((option) => {
          const selected = option.mode === mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => void pick(option.mode)}
              className={`${OPTION_BUTTON_CLASS} ${
                selected
                  ? "bg-gray-800 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </span>
      <span className="w-full pb-1 text-xs font-normal text-gray-500">{DESCRIPTION}</span>
      {failed && (
        <span role="alert" className="w-full text-sm font-normal text-red-700">
          設定を保存できませんでした (元の設定のままです)
        </span>
      )}
    </div>
  );
}
