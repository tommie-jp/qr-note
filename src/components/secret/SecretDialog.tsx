"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BUSY_SPINNER_CLASS,
  MEMO_INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import {
  loadSecret,
  newSecretName,
  saveSecretImage,
  saveSecretText,
  secretText,
} from "@/lib/secretContent";
import { prepareSecretImage } from "@/lib/secretImage";
import { isSecretImageMime } from "@/lib/secretPayload";
import { SecretCancelledError } from "@/lib/secretPrf";
import { isUnlocked, subscribeSecretLock } from "@/lib/secretSession";
import { unlockWithPasskey } from "@/lib/secretUnlock";
import { DEFAULT_SECRET_LABEL, secretLabel, secretUrl } from "@/lib/secrets";

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
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 編集のときは復号してから開く。それまで入力させない
  const [loading, setLoading] = useState(name !== null);
  // 開いてはいけない断片だった (画像を文字として編集しようとした)。
  // 保存を封じないと、空の本文で画素を上書きしてしまう
  const [blocked, setBlocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 施錠されたら閉じる。**開いている間、復号した平文はこの state に居る**ので、
  // 施錠したのに残っていては「施錠 = 手元の復号済みデータは消える」という
  // secretSession.ts の約束が破れる (SecretBlock が同じ購読で中身を畳むのと対)。
  //
  // いまの画面構成では編集画面と設定画面が同時に生きる場面は限られるが、
  // 不変条件をルーティングの偶然に預けない
  useEffect(
    () =>
      subscribeSecretLock(() => {
        if (!isUnlocked()) {
          onClose();
        }
      }),
    [onClose],
  );

  // 既存の断片を開く (編集)。鍵が無ければ先に解錠する
  useEffect(() => {
    if (name === null) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!isUnlocked()) {
          await unlockWithPasskey();
        }
        const content = await loadSecret(name);
        if (cancelled) {
          return;
        }
        // 画像の断片を文字として読み込むと、保存した瞬間に画素が
        // 壊れた文字列で上書きされる。開かずに断る
        if (isSecretImageMime(content.mime)) {
          setBlocked(true);
          setError(
            "これは画像のシークレットです。ここでは編集できません (削除して貼り直してください)",
          );
          return;
        }
        setText(secretText(content));
      } catch (cause) {
        if (cancelled || cause instanceof SecretCancelledError) {
          onClose();
          return;
        }
        setError(message(cause, "シークレットを開けませんでした"));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, onClose]);

  // 断片の中に画像を貼る。**別の断片として暗号化**し、本文には参照だけを書く
  // (通常の画像アップロードは通らないので、サムネも埋め込みもできない)
  const attachImage = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (!isUnlocked()) {
        await unlockWithPasskey();
      }
      const image = await prepareSecretImage(file);
      const imageName = newSecretName();
      await saveSecretImage(imageName, image.mime, image.bytes);
      setText((current) => {
        const separator = current === "" || current.endsWith("\n") ? "" : "\n";
        return `${current}${separator}![画像](${secretUrl(imageName)})\n`;
      });
    } catch (cause) {
      if (cause instanceof SecretCancelledError) {
        return;
      }
      console.error("画像を暗号化できませんでした", cause);
      setError(message(cause, "画像を暗号化できませんでした"));
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(async () => {
    if (text.trim() === "") {
      setError("中身が空です");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!isUnlocked()) {
        await unlockWithPasskey();
      }
      const target = name ?? newSecretName();
      await saveSecretText(target, text);
      onSaved(target, secretLabel(label));
    } catch (cause) {
      if (cause instanceof SecretCancelledError) {
        return;
      }
      console.error("シークレットを保存できませんでした", cause);
      setError(message(cause, "シークレットを保存できませんでした"));
    } finally {
      setBusy(false);
    }
  }, [label, name, onSaved, text]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/90">
      <div className="flex items-center gap-3 bg-white px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-bold">
          🔒 {name === null ? "シークレットを挿入" : "シークレットを編集"}
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

      <div className="flex-1 overflow-auto p-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded bg-white p-3">
          {hideLabel ? (
            /* 閲覧画面から開いたとき。ラベルは本文の平文なので、ここでは
               変えられない (docs/52 §2)。何を編集しているかは示す */
            <p className="text-sm font-medium text-gray-700">{initialLabel}</p>
          ) : (
            <label className="flex flex-col gap-1 text-sm font-medium">
              ラベル (本文に平文で残ります)
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={DEFAULT_SECRET_LABEL}
                {...NO_ASSIST}
                className={MEMO_INPUT_CLASS}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium">
            中身 (markdown。暗号化して保存します)
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              disabled={loading || blocked}
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

          {error !== null && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy || loading || blocked}
              className={SECONDARY_BUTTON_CLASS}
            >
              画像を追加
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                // 同じファイルを続けて選べるように毎回空にする
                e.target.value = "";
                if (file) {
                  void attachImage(file);
                }
              }}
            />
            <span className="flex-1" />
            <button
              type="button"
              onClick={save}
              disabled={busy || loading || blocked}
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
        </div>
      </div>
    </div>,
    document.body,
  );
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}
