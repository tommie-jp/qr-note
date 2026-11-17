"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { MEMO_INPUT_CLASS, SECONDARY_BUTTON_CLASS } from "../ui";
import { useMemoDraft } from "./hooks/useDraftRestore";
import { type SaveConflict, useSaveConflict } from "./hooks/useSaveConflict";
import { useServerFollow } from "./hooks/useServerFollow";
import { PrefillNotice } from "./PrefillNotice";
import { SaveConflictBanner } from "./SaveConflictBanner";
import { type PrefillStatus, type PrefillTarget, usePrefill } from "./usePrefill";

// CodeMirror 一式は重いので、エディタが実際に表示されるまで読み込まない
const MemoEditorInner = dynamic(() => import("./MemoEditorInner"), {
  ssr: false,
  loading: () => null,
});

interface MemoEditorProps {
  defaultValue: string;
  // この本文が載っている版 (docs/87-編集競合対策計画.md §2-2)。
  // formatBase(item?.updatedAt ?? null) をサーバ側で作って渡す。
  //
  // **本文と対でここが持つ**のが要点。フォーム側の hidden に置くと、
  // 同じ画面の markdown タブでチェックを押したときに基点だけが新しくなり、
  // 古い本文の保存が検査を素通りしてチェックを黙って戻してしまう
  base: string;
  autoFocus?: boolean;
  minHeight?: string;
  // 新規登録するコードが ISBN / JAN のときだけ渡す。書誌・商品情報を引いて
  // defaultValue を差し替える (docs/13-書誌自動取得計画.md / docs/14)
  prefill?: PrefillTarget;
  // 渡すと編集中の本文を localStorage に退避する (ノートごとに一意な鍵。
  // 通常は itemId)。タブが落ちても再訪時に復元できる (src/lib/prefs/memoDraft.ts)。
  // iPhone は OCR のモデル読み込みでタブごと再起動することがあり、その保険
  draftKey?: string;
}

// markdown 用 memo エディタ。フォーム送信値は常にここの hidden input が持つため、
// CodeMirror の読み込み完了前に「更新」を押しても現在値がそのまま送信される
// (読み込み中に memo フィールドが欠けてデータが消えることはない)。
//
// 編集競合 (docs/87) の部分はフックに分けた。effect の順は分ける前と同じ:
// サーバへの追随 → 揃え直しの知らせ (useServerFollow) → 下書きの復元
// (useMemoDraft の中の useDraftRestore) → 下書きの保存 (同じく useDraftAutosave)
export function MemoEditor({
  defaultValue,
  base: baseProp,
  autoFocus = false,
  minHeight = "14rem",
  prefill,
  draftKey,
}: MemoEditorProps) {
  // 行末を LF に揃えてから渡す。DB には Ver1 由来の CRLF の本文があり、
  // CodeMirror は行末を LF として扱うので、素のまま渡すと「エディタの中身」と
  // この hidden input が初手から食い違う。すると @uiw/react-codemirror が
  // 差を埋めようと dispatch し、履歴に見えない 1 手が積まれてしまう
  // (何も編集していないのに「元に戻す」が押せ、押すと本文が dirty になる)。
  // どのみち 1 文字でも打てば LF に正規化されて保存されるので、最初から揃える
  const initialValue = useMemo(() => defaultValue.replace(/\r\n/g, "\n"), [defaultValue]);
  const follow = useServerFollow({ initialValue, baseProp });
  // 描く値は分けて受ける。ref と同じ入れ物のまま描画中に他の値を読むと、
  // react-hooks/refs が「ref を描画中に読んだ」と見なす
  const { value, setValue, base, editorKey, serverMoved, markerRef } = follow;
  const draft = useMemoDraft({ ...follow, draftKey, initialValue });
  const saveConflict = useSaveConflict(follow);

  // 書誌・商品情報が届いたら本文を差し替える (まだ何も打っていなければ)。
  // 差し替えは CodeMirror の履歴に 1 手として積まれるので、要らなければ
  // 「元に戻す」で事前入力だけの状態に戻せる
  const prefillStatus = usePrefill({
    target: prefill,
    value,
    pristine: initialValue,
    setMemo: setValue,
  });

  return (
    <div className="space-y-2">
      <span ref={markerRef} hidden />
      <input type="hidden" name="memo" value={value} />
      <input type="hidden" name="base" value={base} />
      {saveConflict.checkpoint && <input type="hidden" name="checkpoint" value="1" />}
      <MemoEditorNotices
        value={value}
        saveConflict={saveConflict}
        serverMoved={serverMoved}
        prefill={prefill}
        prefillStatus={prefillStatus}
        restoredDraft={draft.restoredDraft}
        onDiscardDraft={draft.discardDraft}
      />
      <EditorWithFallback
        editorKey={editorKey}
        value={value}
        onChange={setValue}
        autoFocus={autoFocus}
        minHeight={minHeight}
      />
    </div>
  );
}

// CodeMirror と、読み込みが済むまでの読み取り専用の代わり
function EditorWithFallback({
  editorKey,
  value,
  onChange,
  autoFocus,
  minHeight,
}: {
  editorKey: number;
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  minHeight: string;
}) {
  const [isEditorReady, setIsEditorReady] = useState(false);
  return (
    <>
      {!isEditorReady && (
        <textarea
          readOnly
          rows={8}
          value={value}
          className={MEMO_INPUT_CLASS}
          placeholder="エディタを読み込み中…"
        />
      )}
      <MemoEditorInner
        key={editorKey}
        value={value}
        onChange={onChange}
        onReady={() => setIsEditorReady(true)}
        autoFocus={autoFocus}
        minHeight={minHeight}
      />
    </>
  );
}

// エディタの上に並ぶ知らせ (競合・サーバの変化・書誌取得・下書きの復元)
function MemoEditorNotices({
  value,
  saveConflict,
  serverMoved,
  prefill,
  prefillStatus,
  restoredDraft,
  onDiscardDraft,
}: {
  value: string;
  saveConflict: SaveConflict;
  serverMoved: boolean;
  prefill: PrefillTarget | undefined;
  prefillStatus: PrefillStatus;
  restoredDraft: boolean;
  onDiscardDraft: () => void;
}) {
  const { conflict } = saveConflict;
  return (
    <>
      {conflict && (
        <SaveConflictBanner
          state={conflict}
          value={value}
          onAdoptServer={saveConflict.onAdoptServer}
          onOverwrite={saveConflict.onOverwrite}
          onSaveAsNew={saveConflict.onSaveAsNew}
          onDismiss={saveConflict.onDismiss}
        />
      )}
      {serverMoved && !conflict && (
        <p aria-live="polite" className="text-sm text-gray-500">
          別の操作で本文が変わりました (保存するときに確かめます)
        </p>
      )}
      {/* エディタの上に置く。スキャン直後に目が行くのは本文の先頭で、
          下に置くと見落とす */}
      {prefill && <PrefillNotice kind={prefill.kind} status={prefillStatus} />}
      {restoredDraft && <RestoredDraftNotice onDiscard={onDiscardDraft} />}
    </>
  );
}

// 未保存の下書きを復元したことの知らせ (黙って差し替えない)
function RestoredDraftNotice({ onDiscard }: { onDiscard: () => void }) {
  return (
    <p
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 rounded bg-amber-50 px-3 py-2 text-amber-800"
    >
      保存前の下書きを復元しました。「更新」を押すまで保存はされていません。
      <button type="button" onClick={onDiscard} className={SECONDARY_BUTTON_CLASS}>
        下書きを破棄
      </button>
    </p>
  );
}
