"use client";

import { useState, useSyncExternalStore } from "react";
import { keyringView } from "@/lib/secret/keyringView";
import { isWebAuthnAvailable } from "@/lib/secret/prf";
import { useSecretUnlocked } from "@/lib/secret/session";
import {
  KeyringMessages,
  KeyringStatusSection,
  RecoveryKeySection,
  SetupSection,
  UnlockSection,
  UnlockedSection,
  WrapsSection,
} from "./SecretKeyringSections";
import { keyringButtons, useSecretKeyring } from "./useSecretKeyring";

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
  const manager = useSecretKeyring();
  const { keyring, busy, recoveryKey } = manager;
  // 復旧キーの入力欄。節が消えても値を持ち続ける置き場は以前と同じ (ここ)
  const [recoveryInput, setRecoveryInput] = useState("");
  const buttons = keyringButtons(manager, recoveryInput, setRecoveryInput);

  // どの節を出すかの判断は lib/secret/keyringView.ts (状態の組み合わせ表で
  // テストしてある)。ここはその結果を描くだけ
  const view = keyringView({ keyring, unlocked, webAuthnAvailable });

  return (
    <div className="space-y-4">
      <KeyringStatusSection view={view} />
      <KeyringMessages error={manager.error} notice={manager.notice} />

      {recoveryKey !== null && (
        <RecoveryKeySection
          recoveryKey={recoveryKey}
          onClose={() => manager.setRecoveryKey(null)}
        />
      )}

      {view.showSetup && (
        <SetupSection
          busy={busy}
          disabled={busy || view.loading}
          onSetup={buttons.setup}
        />
      )}

      {view.showUnlock && (
        <UnlockSection
          busy={busy}
          recoveryInput={recoveryInput}
          onRecoveryInput={setRecoveryInput}
          onPasskey={buttons.unlockByPasskey}
          onRecoveryKey={buttons.unlockByRecoveryKey}
        />
      )}

      {view.showUnlocked && (
        <UnlockedSection
          busy={busy}
          onEnroll={buttons.enroll}
          onShowRecoveryKey={manager.showRecoveryKey}
          onLock={buttons.lock}
        />
      )}

      {view.showWraps && <WrapsSection wraps={view.wraps} />}
    </div>
  );
}
