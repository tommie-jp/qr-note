"use client";

import type { RefObject } from "react";
import {
  BUSY_SPINNER_CLASS,
  MEMO_INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import { DEFAULT_SECRET_LABEL } from "@/lib/secret/secrets";

// SecretDialog の画面の部品 (docs/128 §8-1 で分けた)。状態は持たず、
// 受け取った値を描くだけ。平文は props で通るだけで、ここには残らない

// 選択範囲に自前の画像が含まれていたか。含まれていたら注意を出す —
// 画像そのものは images テーブルに平文で残るため (docs/51 §12)
const IMAGE_REF_RE = /!\[[^\]]*\]\(\/api\/images\//;

// 入力補助をすべて切る (復旧キー欄と同じ流儀)。
//
// **spellCheck を切るのが要点**。Chrome の「拡張機能スペルチェック」や
// Grammarly のような拡張は、打った文字をそのまま自社サーバへ送る。サーバ
// 管理者に読ませないための機能なのに、自分のブラウザから第三者へ平文が
// 流れては元も子もない。data-gramm は Grammarly を明示的に外すための印。
const NO_ASSIST = {
  spellCheck: false,
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  "data-gramm": "false",
  "data-gramm_editor": "false",
  "data-enable-grammarly": "false",
} as const;

export function SecretDialogHeader({
  isNew,
  busy,
  onClose,
}: {
  isNew: boolean;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-white px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-bold">
        🔒 {isNew ? "シークレットを挿入" : "シークレットを編集"}
      </span>
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
      >
        閉じる
      </button>
    </div>
  );
}

export function SecretLabelField({
  hideLabel,
  initialLabel,
  label,
  onChange,
}: {
  hideLabel: boolean;
  initialLabel: string;
  label: string;
  onChange: (label: string) => void;
}) {
  if (hideLabel) {
    /* 閲覧画面から開いたとき。ラベルは本文の平文なので、ここでは
       変えられない (docs/52 §2)。何を編集しているかは示す */
    return <p className="text-sm font-medium text-gray-700">{initialLabel}</p>;
  }
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      ラベル (本文に平文で残ります)
      <input
        type="text"
        value={label}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_SECRET_LABEL}
        {...NO_ASSIST}
        className={MEMO_INPUT_CLASS}
      />
    </label>
  );
}

// 中身の入力欄と、自前の画像を含むときの注意
export function SecretTextField({
  textRef,
  text,
  onChange,
  disabled,
}: {
  textRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onChange: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        中身 (markdown。暗号化して保存します)
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          disabled={disabled}
          autoFocus
          {...NO_ASSIST}
          className={`${MEMO_INPUT_CLASS} resize-y`}
        />
      </label>

      {IMAGE_REF_RE.test(text) && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          画像の参照が含まれています。
          <strong>通常の画像はサーバに平文のまま残ります。</strong>
          隠したい画像は下の「画像を追加」から貼り直してください。
        </p>
      )}
    </>
  );
}

export function SecretDialogError({ error }: { error: string | null }) {
  if (error === null) {
    return null;
  }
  return (
    <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  );
}

export function SecretSaveRow({
  busy,
  disabled,
  onSave,
}: {
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className={PRIMARY_BUTTON_CLASS}
        >
          {busy && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
          {busy ? "保存中" : "暗号化して保存"}
        </button>
      </div>

      <p className="text-sm text-gray-500">
        中身は端末の中で暗号化してから送ります。サーバ (と管理者) が読めるのは
        ラベルだけです。
      </p>
    </>
  );
}
