"use client";

import { useCallback, useEffect, useState } from "react";
import { useAsyncAction } from "@/components/hooks/useAsyncAction";
import { fetchKeyring, type KeyringState } from "@/lib/secret/api";
import { encodeRecoveryKey, formatRecoveryKey } from "@/lib/secret/keyring";
import { SecretCancelledError } from "@/lib/secret/prf";
import { lockSecrets, unlockedMasterKeyBytes } from "@/lib/secret/session";
import {
  enrollThisDevice,
  setupSecrets,
  unlockWithPasskey,
  unlockWithRecoveryKey,
} from "@/lib/secret/unlock";

// SecretKeyringManager の状態と操作をフックに分けたもの (docs/128 §8-1)。
// SecretKeyringManager の中でだけ呼ぶので、復旧キーの表示文字列の寿命は
// 以前と同じ (画面を離れれば消える)

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

// 鍵束の状態の取得。初回の読み込みと、操作のあとの読み直し
function useKeyringState(setError: (error: string | null) => void) {
  const [keyring, setKeyring] = useState<KeyringState | null>(null);

  const reload = useCallback(async () => {
    try {
      setKeyring(await fetchKeyring());
    } catch (cause) {
      setError(message(cause, "設定を読み込めませんでした"));
    }
  }, [setError]);

  // 初回の読み込み。**effect の中で setState を直に呼ばない** (React の
  // 助言どおり) ため、取得の後始末として書く。以後の読み直しは操作の
  // ハンドラ (run) から reload() を呼ぶ
  useEffect(() => {
    let cancelled = false;
    fetchKeyring()
      .then((state) => {
        if (!cancelled) {
          setKeyring(state);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(message(cause, "設定を読み込めませんでした"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  return { keyring, reload };
}

export type KeyringRun = (
  action: () => Promise<void>,
  done: string | null,
) => Promise<void>;

export function useSecretKeyring() {
  const { run: runAction, busy, error, setError } = useAsyncAction();
  const [notice, setNotice] = useState<string | null>(null);
  // 初回設定の直後にだけ出す復旧キー。閉じたら二度と出せない
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const { keyring, reload } = useKeyringState(setError);

  // 押した操作をまとめて包む。取り消し (Face ID を閉じた) は失敗にしない
  const run: KeyringRun = useCallback(
    (action: () => Promise<void>, done: string | null) =>
      runAction(
        async () => {
          setNotice(null);
          await action();
          if (done !== null) {
            setNotice(done);
          }
          await reload();
        },
        (cause) => {
          if (cause instanceof SecretCancelledError) {
            return null;
          }
          console.error("シークレットの鍵操作に失敗しました", cause);
          return message(cause, "操作に失敗しました");
        },
      ),
    [reload, runAction],
  );

  // 解錠中なら、いつでも手元のマスターキーから復旧キーを組み直せる
  // (サーバは平文の鍵を持たないので、これはブラウザだけで完結する)
  const showRecoveryKey = useCallback(() => {
    const masterKey = unlockedMasterKeyBytes();
    if (masterKey === null) {
      setError("先に解錠してください");
      return;
    }
    setNotice(null);
    setRecoveryKey(formatRecoveryKey(encodeRecoveryKey(masterKey)));
  }, [setError]);

  return {
    keyring,
    busy,
    error,
    notice,
    setNotice,
    recoveryKey,
    setRecoveryKey,
    run,
    showRecoveryKey,
  };
}

// 各節の釦が呼ぶ操作。中身は分ける前の onClick と同じ (描画ごとに作り直す
// のも以前と同じ)。復旧キーの入力欄の値は画面側の state のまま受け取る
export function keyringButtons(
  { run, setRecoveryKey, setNotice }: ReturnType<typeof useSecretKeyring>,
  recoveryInput: string,
  setRecoveryInput: (value: string) => void,
) {
  return {
    setup: () =>
      void run(async () => {
        setRecoveryKey(await setupSecrets());
      }, null),
    unlockByPasskey: () => void run(unlockWithPasskey, "解錠しました"),
    unlockByRecoveryKey: () =>
      void run(async () => {
        await unlockWithRecoveryKey(recoveryInput);
        setRecoveryInput("");
      }, "復旧キーで解錠しました"),
    enroll: () =>
      void run(enrollThisDevice, "このパスキーで解錠できるようにしました"),
    lock: () => {
      lockSecrets();
      setNotice("施錠しました");
    },
  };
}
