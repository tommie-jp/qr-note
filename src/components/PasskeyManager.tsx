"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BOX_CLASS,
  DANGER_BUTTON_CLASS,
  MEMO_INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/components/ui";
import { PASSKEYS_PATH } from "@/lib/auth/paths";
import { errorText } from "@/lib/errorMessage";
import { PASSKEY_LABEL_MAX } from "@/lib/auth/passkeyLabel";
import { PasskeyCancelledError, registerPasskey } from "@/lib/auth/passkeyClient";

// 一覧は Server Component が渡す (docs/29-パスキー計画.md §8)。
// 日付は文字列にして降ろす — Date をそのまま渡すと、サーバとクライアントで
// タイムゾーンや書式がずれて hydration mismatch になる
export interface PasskeyRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PasskeyManagerProps {
  passkeys: PasskeyRow[];
  // 設定 (WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN) が入っているか。
  // 入っていなければ登録ボタンを出さない (押しても 503 になるだけ)
  isEnabled: boolean;
}

export function PasskeyManager({ passkeys, isEnabled }: PasskeyManagerProps) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"register" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister() {
    setError(null);
    setBusy("register");
    try {
      await registerPasskey(label);
      setLabel("");
      // 一覧はサーバが持っているので描き直してもらう
      router.refresh();
    } catch (cause) {
      if (!(cause instanceof PasskeyCancelledError)) {
        setError(errorText(cause, "登録できませんでした"));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(passkey: PasskeyRow) {
    // 消すと、その端末からはパスワードでしか入れなくなる。押し間違いで
    // 消えないよう一拍置かせる (DANGER_BUTTON_CLASS と対の考え方)
    if (!window.confirm(`「${passkey.label}」を削除しますか?`)) {
      return;
    }

    setError(null);
    setBusy("delete");
    try {
      const response = await fetch(
        `${PASSKEYS_PATH}/${encodeURIComponent(passkey.id)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!response.ok) {
        throw new Error(`削除できませんでした (${response.status})`);
      }
      router.refresh();
    } catch (cause) {
      console.error("パスキーの削除に失敗しました", cause);
      setError(errorText(cause, "削除できませんでした"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${BOX_CLASS} space-y-3 py-4`}>
        <h2 className="font-bold">この端末を登録する</h2>
        {isEnabled ? (
          <>
            <label className="block space-y-1">
              <span className="text-sm text-gray-600">
                名前 (一覧で見分けるためだけのもの。省略可)
              </span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={PASSKEY_LABEL_MAX}
                placeholder="iPhone"
                className={MEMO_INPUT_CLASS}
              />
            </label>
            <button
              type="button"
              onClick={handleRegister}
              disabled={busy !== null}
              className={PRIMARY_BUTTON_CLASS}
            >
              {busy === "register" ? "登録中…" : "この端末を登録"}
            </button>
          </>
        ) : (
          <p className="text-gray-600">
            この環境ではパスキーを利用できません (WEBAUTHN_RP_ID と
            WEBAUTHN_ORIGIN が未設定)。
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">登録済みのパスキー</h2>
        {passkeys.length === 0 ? (
          <p className="text-gray-600">
            まだ登録されていません。登録するまではパスワードでログインします。
          </p>
        ) : (
          <ul className="space-y-2">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className={`${BOX_CLASS} flex items-center gap-3 py-3`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{passkey.label}</p>
                  <p className="text-sm text-gray-500">
                    登録 {passkey.createdAt}
                    {passkey.lastUsedAt
                      ? ` / 最終使用 ${passkey.lastUsedAt}`
                      : " / 未使用"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(passkey)}
                  disabled={busy !== null}
                  className={DANGER_BUTTON_CLASS}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
