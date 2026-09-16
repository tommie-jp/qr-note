"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAsyncAction } from "@/components/hooks/useAsyncAction";
import {
  BOX_CLASS,
  BUSY_SPINNER_CLASS,
  MEMO_INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import { fetchKeyring, type KeyringState } from "@/lib/secret/api";
import {
  RECOVERY_KEY_LENGTH,
  encodeRecoveryKey,
  formatRecoveryKey,
} from "@/lib/secret/keyring";
import { keyringView } from "@/lib/secret/keyringView";
import { SecretCancelledError, isWebAuthnAvailable } from "@/lib/secret/prf";
import {
  lockSecrets,
  unlockedMasterKeyBytes,
  useSecretUnlocked,
} from "@/lib/secret/session";
import {
  enrollThisDevice,
  setupSecrets,
  unlockWithPasskey,
  unlockWithRecoveryKey,
} from "@/lib/secret/unlock";

// シークレットの鍵の設定画面 (docs/51-部分暗号化計画.md §6)。
//
// ここでできることは 4 つ: 初回設定・解錠・この端末で有効化・施錠。
// **復旧キーを見せるのは初回設定の直後だけ** — サーバは平文の鍵を持たないので、
// 二度と表示できない。
// パスキーの有無はブラウザでしか判らない。描画中に isWebAuthnAvailable() を
// 呼ぶと、サーバ描画 (window が無い = 使えない) とクライアントの最初の描画が
// 食い違い、hydration の警告になる (dev で実際に出ていた)。useSyncExternalStore
// なら「サーバの値で描き、クライアントの値に揃え直す」を React が正しく扱う。
// サーバの値を「使える」にするのは、使えるブラウザが大半で、注意書きが
// 一瞬出て消えるより、無い状態から必要なら出るほうが落ち着くため
const subscribeNever = () => () => {};
function useWebAuthnAvailable(): boolean {
  return useSyncExternalStore(subscribeNever, isWebAuthnAvailable, () => true);
}

export function SecretKeyringManager() {
  const unlocked = useSecretUnlocked();
  const webAuthnAvailable = useWebAuthnAvailable();
  const [keyring, setKeyring] = useState<KeyringState | null>(null);
  const { run: runAction, busy, error, setError } = useAsyncAction();
  const [notice, setNotice] = useState<string | null>(null);
  // 初回設定の直後にだけ出す復旧キー。閉じたら二度と出せない
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryInput, setRecoveryInput] = useState("");

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

  // 押した操作をまとめて包む。取り消し (Face ID を閉じた) は失敗にしない
  const run = useCallback(
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

  // どの節を出すかの判断は lib/secret/keyringView.ts (状態の組み合わせ表で
  // テストしてある)。ここはその結果を描くだけ
  const view = keyringView({ keyring, unlocked, webAuthnAvailable });

  return (
    <div className="space-y-4">
      <section className={`${BOX_CLASS} space-y-2`}>
        <h2 className="font-bold">状態</h2>
        <p className="text-sm text-gray-700">
          {view.status}
          {view.lockNote}
        </p>
        {view.showWebAuthnNotice && (
          <p className="text-sm text-amber-800">
            この環境ではパスキーを使えません。復旧キーで解錠してください。
          </p>
        )}
      </section>

      {error !== null && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {notice !== null && (
        <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}

      {recoveryKey !== null && (
        <section className="space-y-2 rounded border-2 border-amber-500 bg-amber-50 px-3 py-3">
          <h2 className="font-bold text-amber-900">
            復旧キー — いま紙に控えてください
          </h2>
          <p className="text-sm text-amber-900">
            サーバは鍵の平文を持たないため、これを失うと全パスキーを失ったときに
            シークレットが永久に読めなくなります。
            <strong>
              解錠中なら「復旧キーを表示」でいつでも出し直せますが、施錠して
              しまうと表示できません。
            </strong>
          </p>
          <p className="rounded bg-white px-3 py-2 font-mono text-sm break-all select-all">
            {recoveryKey}
          </p>
          <button
            type="button"
            onClick={() => setRecoveryKey(null)}
            className={SECONDARY_BUTTON_CLASS}
          >
            控えたので閉じる
          </button>
        </section>
      )}

      {view.showSetup && (
        <section className={`${BOX_CLASS} space-y-2`}>
          <h2 className="font-bold">暗号化を設定する</h2>
          <p className="text-sm text-gray-700">
            マスターキーを作り、この端末のパスキーで包んで保存します。
            続けて復旧キーを表示するので、紙に控えてください。
          </p>
          <button
            type="button"
            disabled={busy || view.loading}
            onClick={() =>
              void run(async () => {
                setRecoveryKey(await setupSecrets());
              }, null)
            }
            className={PRIMARY_BUTTON_CLASS}
          >
            {busy && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
            設定する
          </button>
        </section>
      )}

      {view.showUnlock && (
        <section className={`${BOX_CLASS} space-y-3`}>
          <h2 className="font-bold">解錠する</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(unlockWithPasskey, "解錠しました")}
            className={PRIMARY_BUTTON_CLASS}
          >
            {busy && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
            パスキーで解錠
          </button>
          <div className="space-y-1">
            <label className="flex flex-col gap-1 text-sm font-medium">
              復旧キーで解錠 ({RECOVERY_KEY_LENGTH} 文字)
              <input
                type="text"
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-…"
                autoComplete="off"
                spellCheck={false}
                className={`${MEMO_INPUT_CLASS} font-mono`}
              />
            </label>
            <button
              type="button"
              disabled={busy || recoveryInput.trim() === ""}
              onClick={() =>
                void run(async () => {
                  await unlockWithRecoveryKey(recoveryInput);
                  setRecoveryInput("");
                }, "復旧キーで解錠しました")
              }
              className={SECONDARY_BUTTON_CLASS}
            >
              復旧キーで解錠
            </button>
          </div>
        </section>
      )}

      {view.showUnlocked && (
        <section className={`${BOX_CLASS} space-y-2`}>
          <h2 className="font-bold">この端末のパスキーで解錠できるようにする</h2>
          <p className="text-sm text-gray-700">
            いま使っているパスキーにマスターキーを包み直します。2 台目の端末や、
            復旧キーで解錠したあとに実行してください。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(enrollThisDevice, "このパスキーで解錠できるようにしました")
              }
              className={PRIMARY_BUTTON_CLASS}
            >
              {busy && <span aria-hidden className={BUSY_SPINNER_CLASS} />}
              有効にする
            </button>
            {/* 復旧キーの控え直し。初回設定の直後に通信が切れると、サーバは
                設定済みなのに復旧キーを一度も見ないまま運用が始まってしまう。
                解錠中なら手元にマスターキーがあるので、サーバに触らず何度でも
                出し直せる (この導線が無いと、気づいても取り返せない) */}
            <button
              type="button"
              disabled={busy}
              onClick={showRecoveryKey}
              className={SECONDARY_BUTTON_CLASS}
            >
              復旧キーを表示
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                lockSecrets();
                setNotice("施錠しました");
              }}
              className={SECONDARY_BUTTON_CLASS}
            >
              施錠する
            </button>
          </div>
        </section>
      )}

      {view.showWraps && (
        <section className={`${BOX_CLASS} space-y-2`}>
          <h2 className="font-bold">パスキーごとの状態</h2>
          <ul className="space-y-1 text-sm">
            {view.wraps.map((wrap) => (
              <li key={wrap.credentialId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{wrap.label}</span>
                <span
                  className={
                    wrap.wrapped === null ? "text-gray-500" : "text-green-700"
                  }
                >
                  {wrap.wrapped === null ? "未設定" : "解錠に使えます"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}
