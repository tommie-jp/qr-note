"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { insertBlockAtSelection } from "@/lib/editor/insertAtSelection";
import {
  loadSecret,
  newSecretName,
  saveSecretText,
  secretText,
} from "@/lib/secret/content";
import { isSecretImageMime } from "@/lib/secret/payload";
import { SecretCancelledError } from "@/lib/secret/prf";
import { isUnlocked, subscribeSecretLock } from "@/lib/secret/session";
import { unlockWithPasskey } from "@/lib/secret/unlock";
import { secretLabel } from "@/lib/secret/secrets";
import type { SecretSelection } from "./useSecretTools";

// SecretDialog の手順をフックに分けたもの (docs/128 §8-1)。
//
// **復号した平文はここの useState に居る**。フックは SecretDialog の中でだけ
// 呼ぶので、寿命はダイアログと同じ (閉じれば消える)。外へ持ち出さない

function secretErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

interface DraftSetters {
  setText: Dispatch<SetStateAction<string>>;
  setBlocked: (blocked: boolean) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

// 既存の断片を開く (編集)。鍵が無ければ先に解錠する。
// 解錠 → 復号 → (取り消し済みでなければ) 反映、の順は以前のまま
async function loadSecretDraft(
  name: string,
  isCancelled: () => boolean,
  { setText, setBlocked, setError, setLoading }: DraftSetters,
  onClose: () => void,
): Promise<void> {
  try {
    if (!isUnlocked()) {
      await unlockWithPasskey();
    }
    const content = await loadSecret(name);
    if (isCancelled()) {
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
    if (isCancelled() || cause instanceof SecretCancelledError) {
      onClose();
      return;
    }
    setError(secretErrorMessage(cause, "シークレットを開けませんでした"));
  } finally {
    if (!isCancelled()) {
      setLoading(false);
    }
  }
}

// 本文 (平文) と、その読み込みの状態。施錠されたら閉じる購読もここに置く
export function useSecretDraft(
  name: string | null,
  initialText: string,
  onClose: () => void,
) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  // 編集のときは復号してから開く。それまで入力させない
  const [loading, setLoading] = useState(name !== null);
  // 開いてはいけない断片だった (画像を文字として編集しようとした)。
  // 保存を封じないと、空の本文で画素を上書きしてしまう
  const [blocked, setBlocked] = useState(false);

  // 施錠されたら閉じる。**開いている間、復号した平文はこの state に居る**ので、
  // 施錠したのに残っていては「施錠 = 手元の復号済みデータは消える」という
  // secret/session.ts の約束が破れる (SecretBlock が同じ購読で中身を畳むのと対)。
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

  useEffect(() => {
    if (name === null) {
      return;
    }
    let cancelled = false;
    void loadSecretDraft(
      name,
      () => cancelled,
      { setText, setBlocked, setError, setLoading },
      onClose,
    );
    return () => {
      cancelled = true;
    };
  }, [name, onClose]);

  return { text, setText, error, setError, loading, blocked };
}

// textarea の選択範囲を読む口と、そこへ 1 ブロック差し込む口
export function useSecretTextArea(
  text: string,
  setText: Dispatch<SetStateAction<string>>,
) {
  const textRef = useRef<HTMLTextAreaElement>(null);

  // 道具が使う「いまどこを見ているか」。textarea の選択範囲をそのまま返す。
  // 参照が無い (まだ描かれていない) ときは末尾を指しておく
  const getSelection = useCallback((): SecretSelection => {
    const area = textRef.current;
    return {
      text,
      from: area?.selectionStart ?? text.length,
      to: area?.selectionEnd ?? text.length,
    };
  }, [text]);

  // 道具が作ったものを 1 ブロックとして差し込む。
  // **カーソルは差し込んだ直後へ送る** — 続けて OCR を押したときに、いま
  // 入れた画像が対象になる (編集画面の insertBlock と同じ手触り)
  const insertBlock = useCallback(
    (markdown: string) => {
      const area = textRef.current;
      setText((current) => {
        const from = area?.selectionStart ?? current.length;
        const to = area?.selectionEnd ?? current.length;
        const next = insertBlockAtSelection(current, from, to, markdown);
        // 描き直しの後でカーソルを動かす (value の反映より前に動かすと戻される)
        queueMicrotask(() => {
          area?.setSelectionRange(next.cursor, next.cursor);
          area?.focus();
        });
        return next.text;
      });
    },
    [setText],
  );

  return { textRef, getSelection, insertBlock };
}

// 封をして保存する。鍵が無ければ先に解錠する
export function useSecretSave({
  name,
  text,
  label,
  onSaved,
  setBusy,
  setError,
}: {
  name: string | null;
  text: string;
  label: string;
  onSaved: (name: string, label: string) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}) {
  return useCallback(async () => {
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
      setError(secretErrorMessage(cause, "シークレットを保存できませんでした"));
    } finally {
      setBusy(false);
    }
  }, [label, name, onSaved, text, setBusy, setError]);
}
