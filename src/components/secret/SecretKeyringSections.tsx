"use client";

import {
  BOX_CLASS,
  BUSY_SPINNER_CLASS,
  MEMO_INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui";
import { RECOVERY_KEY_LENGTH } from "@/lib/secret/keyring";
import type { KeyringView } from "@/lib/secret/keyringView";

// SecretKeyringManager の各節 (docs/128 §8-1 で分けた)。状態は持たず、
// どの節を出すかも呼ぶ側 (keyringView の結果) が決める

function BusySpinner({ busy }: { busy: boolean }) {
  return busy ? <span aria-hidden className={BUSY_SPINNER_CLASS} /> : null;
}

export function KeyringStatusSection({ view }: { view: KeyringView }) {
  return (
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
  );
}

export function KeyringMessages({
  error,
  notice,
}: {
  error: string | null;
  notice: string | null;
}) {
  return (
    <>
      {error !== null && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {notice !== null && (
        <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
    </>
  );
}

export function RecoveryKeySection({
  recoveryKey,
  onClose,
}: {
  recoveryKey: string;
  onClose: () => void;
}) {
  return (
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
      <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
        控えたので閉じる
      </button>
    </section>
  );
}

export function SetupSection({
  busy,
  disabled,
  onSetup,
}: {
  busy: boolean;
  disabled: boolean;
  onSetup: () => void;
}) {
  return (
    <section className={`${BOX_CLASS} space-y-2`}>
      <h2 className="font-bold">暗号化を設定する</h2>
      <p className="text-sm text-gray-700">
        マスターキーを作り、この端末のパスキーで包んで保存します。
        続けて復旧キーを表示するので、紙に控えてください。
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onSetup}
        className={PRIMARY_BUTTON_CLASS}
      >
        <BusySpinner busy={busy} />
        設定する
      </button>
    </section>
  );
}

export function UnlockSection({
  busy,
  recoveryInput,
  onRecoveryInput,
  onPasskey,
  onRecoveryKey,
}: {
  busy: boolean;
  recoveryInput: string;
  onRecoveryInput: (value: string) => void;
  onPasskey: () => void;
  onRecoveryKey: () => void;
}) {
  return (
    <section className={`${BOX_CLASS} space-y-3`}>
      <h2 className="font-bold">解錠する</h2>
      <button
        type="button"
        disabled={busy}
        onClick={onPasskey}
        className={PRIMARY_BUTTON_CLASS}
      >
        <BusySpinner busy={busy} />
        パスキーで解錠
      </button>
      <div className="space-y-1">
        <label className="flex flex-col gap-1 text-sm font-medium">
          復旧キーで解錠 ({RECOVERY_KEY_LENGTH} 文字)
          <input
            type="text"
            value={recoveryInput}
            onChange={(e) => onRecoveryInput(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-…"
            autoComplete="off"
            spellCheck={false}
            className={`${MEMO_INPUT_CLASS} font-mono`}
          />
        </label>
        <button
          type="button"
          disabled={busy || recoveryInput.trim() === ""}
          onClick={onRecoveryKey}
          className={SECONDARY_BUTTON_CLASS}
        >
          復旧キーで解錠
        </button>
      </div>
    </section>
  );
}

export function UnlockedSection({
  busy,
  onEnroll,
  onShowRecoveryKey,
  onLock,
}: {
  busy: boolean;
  onEnroll: () => void;
  onShowRecoveryKey: () => void;
  onLock: () => void;
}) {
  return (
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
          onClick={onEnroll}
          className={PRIMARY_BUTTON_CLASS}
        >
          <BusySpinner busy={busy} />
          有効にする
        </button>
        {/* 復旧キーの控え直し。初回設定の直後に通信が切れると、サーバは
            設定済みなのに復旧キーを一度も見ないまま運用が始まってしまう。
            解錠中なら手元にマスターキーがあるので、サーバに触らず何度でも
            出し直せる (この導線が無いと、気づいても取り返せない) */}
        <button
          type="button"
          disabled={busy}
          onClick={onShowRecoveryKey}
          className={SECONDARY_BUTTON_CLASS}
        >
          復旧キーを表示
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onLock}
          className={SECONDARY_BUTTON_CLASS}
        >
          施錠する
        </button>
      </div>
    </section>
  );
}

export function WrapsSection({ wraps }: { wraps: KeyringView["wraps"] }) {
  return (
    <section className={`${BOX_CLASS} space-y-2`}>
      <h2 className="font-bold">パスキーごとの状態</h2>
      <ul className="space-y-1 text-sm">
        {wraps.map((wrap) => (
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
  );
}
