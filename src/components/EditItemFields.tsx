"use client";

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ADOPT_SERVER_EVENT, type AdoptServerDetail } from "@/lib/editorEvents";
import { MAX_TEXT_LENGTH, type Mode } from "@/lib/validation";
import { SaveFormContext } from "./NoteSaveForm";
import { MEMO_INPUT_CLASS } from "./ui";

interface EditItemFieldsProps {
  defaultUrl: string;
  defaultMode: Mode;
  // 種別と URL の間に本文エディタを挟む (画面の並びを変えない)
  children: ReactNode;
}

// /edit の mode / url (docs/87-編集競合対策計画.md §3-2)。
//
// **制御コンポーネントにしてあるのが要点。** React 19 の `<form action={fn}>` は
// 送信時にフォームのリセットを予約するので、競合で値だけが返ってくると
// 非制御の入力 (defaultValue / defaultChecked) はサーバ描画時の値へ巻き戻る。
// 本文は MemoEditor の hidden が制御なので無事だが、ここは自分で持たないと
// 「競合バナーが出た瞬間に URL の打ち込みが消える」ことになる。
//
// **value は React が復元するが checked は戻らない** (ローカルの実機で確認)。
// 制御コンポーネントにしても、リセットで DOM の checked だけが既定へ落ち、
// React の state と食い違ったままになる。そのまま次の「更新」を押すと
// FormData は DOM を読むので、**選んでいない種別が黙って保存される**。
// 結果が返るたびに DOM へ当て直して食い違いを消す。
//
// 「別の版を読み込む」もここで受ける。バナーは MemoEditor の中にあるので、
// 同じフォームへ飛ぶ DOM イベントで揃える (lib/editorEvents.ts)。
export function EditItemFields({
  defaultUrl,
  defaultMode,
  children,
}: EditItemFieldsProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const markerRef = useRef<HTMLSpanElement>(null);
  const saveState = useContext(SaveFormContext);
  const server = saveState?.server ?? null;

  useEffect(() => {
    const form = markerRef.current?.closest("form");
    if (!form) {
      return;
    }
    const handleAdopt = (event: Event) => {
      const detail = (event as CustomEvent<AdoptServerDetail>).detail;
      setUrl(detail.url);
      setMode(detail.mode);
    };
    form.addEventListener(ADOPT_SERVER_EVENT, handleAdopt);
    return () => form.removeEventListener(ADOPT_SERVER_EVENT, handleAdopt);
  }, []);

  // 送信のたびに予約されるフォームのリセットで checked が既定へ落ちるので、
  // 結果が返ってきたら React の state から当て直す (上のコメント参照)
  useEffect(() => {
    const form = markerRef.current?.closest("form");
    if (!form) {
      return;
    }
    for (const radio of form.querySelectorAll<HTMLInputElement>(
      'input[name="mode"]',
    )) {
      radio.checked = radio.value === mode;
    }
  }, [saveState, mode]);

  return (
    <>
      <span ref={markerRef} hidden />
      <fieldset className="flex gap-6">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name="mode"
            value="memo"
            checked={mode === "memo"}
            onChange={() => setMode("memo")}
            className="size-4"
          />
          メモ
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name="mode"
            value="url"
            checked={mode === "url"}
            onChange={() => setMode("url")}
            className="size-4"
          />
          URL
        </label>
      </fieldset>

      {children}

      {/* 打ち止めは本文と同じ定数を見る (lib/validation.ts)。10,000 を直に
          書いていた頃は、ZIP / ENEX から取り込んだ 10,000 字超の url が
          編集画面で黙って切り詰められていた */}
      <textarea
        name="url"
        rows={3}
        maxLength={MAX_TEXT_LENGTH}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="URLを入力して下さい。"
        className={MEMO_INPUT_CLASS}
      />

      {/* 本文だけでなく URL や種別も食い違っていることがある。
          これらは git 履歴に入らない (notes/<itemNo>.md は本文だけ) ので、
          上書きしたら戻せない — バナーの本文差分とは別に、ここで言い添える */}
      {server && server.url !== url && (
        <p aria-live="polite" className="break-all text-sm text-amber-800">
          別の版の URL は{" "}
          <span className="font-mono">{server.url === "" ? "(空)" : server.url}</span>
          {" "}です (上書きすると履歴には残りません)
        </p>
      )}
      {server && server.mode !== mode && (
        <p aria-live="polite" className="text-sm text-amber-800">
          別の版の種別は「{server.mode === "url" ? "URL" : "メモ"}」です
        </p>
      )}
    </>
  );
}
