"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/modal/ModalOverlay";
import { useEscapeKey } from "@/components/modal/useEscapeKey";
import {
  SecretDialogError,
  SecretDialogHeader,
  SecretLabelField,
  SecretSaveRow,
  SecretTextField,
} from "./SecretDialogParts";
import { SecretTools } from "./SecretTools";
import { useSecretDraft, useSecretSave, useSecretTextArea } from "./useSecretDialog";

export interface SecretDialogProps {
  // 編集する断片の名前。null なら新規
  name: string | null;
  // 新規のとき、本文の選択範囲を引き継いだ初期値 (docs/51 §12 の移行導線)
  initialText: string;
  initialLabel: string;
  // ラベル欄を出さない (docs/52-シークレット編集導線計画.md §2)。
  //
  // 閲覧画面から開いたときに true。ラベルは**本文の平文**なので、変えるには
  // memo を保存し直す必要があり、それは編集画面の仕事。中身の編集は同名
  // 上書きで本文に触れないため、閲覧画面からでも成立する。
  // onSaved には initialLabel がそのまま返る (呼ぶ側は本文に触らない)
  hideLabel?: boolean;
  // 保存できたら呼ぶ。新規なら本文へ記法を挿す (name は新しい断片の名前)
  onSaved: (name: string, label: string) => void;
  onClose: () => void;
}

// シークレット断片の入力ダイアログ (docs/51-部分暗号化計画.md §8)。
//
// **本文 (memo) の state を一度も経由しない**のが最大の要点。エディタに平文で
// 書いてから暗号化する形にすると、暗号化ボタンを押す前に自動保存が走った時点で
// 平文がサーバへ届き、しかも一度でも pg_dump に乗れば過去のバックアップに
// 平文が残り続ける。ここで書いた内容は、封をしてからでないと外へ出ない。
export function SecretDialog({
  name,
  initialText,
  initialLabel,
  hideLabel = false,
  onSaved,
  onClose,
}: SecretDialogProps) {
  const [label, setLabel] = useState(initialLabel);
  const [busy, setBusy] = useState(false);

  // 効果の順は以前のまま: Esc → 施錠で閉じる → 既存の断片を開く
  useEscapeKey(onClose);
  const { text, setText, error, setError, loading, blocked } =
    useSecretDraft(name, initialText, onClose);
  const { textRef, getSelection, insertBlock } = useSecretTextArea(text, setText);
  const save = useSecretSave({ name, text, label, onSaved, setBusy, setError });
  const locked = busy || loading || blocked;

  return (
    <ModalOverlay variant="viewer">
      <SecretDialogHeader isNew={name === null} busy={busy} onClose={onClose} />

      <div className="flex-1 overflow-auto p-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded bg-white p-3">
          <SecretLabelField
            hideLabel={hideLabel}
            initialLabel={initialLabel}
            label={label}
            onChange={setLabel}
          />

          <SecretTextField
            textRef={textRef}
            text={text}
            onChange={setText}
            disabled={loading || blocked}
          />

          <SecretDialogError error={error} />

          {/* 編集画面で挿せるものはすべてここから入れられる (docs/53)。
              どれも保存前にこのブラウザで暗号化されるので、平文がサーバへ
              出る経路は無い */}
          <SecretTools
            disabled={locked}
            getSelection={getSelection}
            insertBlock={insertBlock}
            onBusyChange={setBusy}
            onError={setError}
          />

          <SecretSaveRow busy={busy} disabled={locked} onSave={save} />
        </div>
      </div>
    </ModalOverlay>
  );
}
