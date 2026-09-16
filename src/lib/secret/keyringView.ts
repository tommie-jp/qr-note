// 鍵の設定画面で「どの節を出すか」の判断 (docs/51-部分暗号化計画.md §6)。
//
// もとは components/secret/SecretKeyringManager.tsx の JSX の条件式にあった。
// 状態の組み合わせ (読み込み前 / 未設定 / 設定済み × 施錠・解錠 / 包みの有無 /
// パスキーの可否) を表でテストできるよう純関数にし、部品はこの結果から描くだけに
// する (docs/96-シークレット・お絵かきのテスト計画.md §4-2)。条件は移した
// だけで、出す節と文言は変えていない。

import type { KeyWrapInfo, KeyringState } from './api'

export interface KeyringViewInput {
  // サーバから取った鍵束。null = まだ読み込んでいない (effect で取る)
  keyring: KeyringState | null
  // いまこのタブで解錠しているか (session.ts)
  unlocked: boolean
  // このブラウザでパスキーが使えるか (prf.ts の isWebAuthnAvailable)
  webAuthnAvailable: boolean
}

export interface KeyringView {
  // 「状態」の 1 文目 (読み込み中 / 設定済みと解錠できるパスキーの数 / 未設定)
  status: string
  // 「状態」の 2 文目。設定済みのときだけ、解錠中か施錠中かを添える
  lockNote: string | null
  // まだ鍵束を読み込んでいない (設定するボタンを押せない)
  loading: boolean
  // 「この環境ではパスキーを使えません」の注意
  showWebAuthnNotice: boolean
  // 「暗号化を設定する」の節。未設定のあいだ出す (読み込み前も出るが押せない)
  showSetup: boolean
  // 「解錠する」の節 (設定済みで施錠中)
  showUnlock: boolean
  // 「この端末のパスキーで解錠できるようにする」の節 (設定済みで解錠中)。
  // 復旧キーの表示と施錠もここに並ぶ
  showUnlocked: boolean
  // 「パスキーごとの状態」の一覧。登録済みのパスキーがあるときだけ
  showWraps: boolean
  wraps: readonly KeyWrapInfo[]
}

export function keyringView({
  keyring,
  unlocked,
  webAuthnAvailable,
}: KeyringViewInput): KeyringView {
  const initialized = keyring?.initialized ?? false
  const enrolledCount =
    keyring?.wraps.filter((wrap) => wrap.wrapped !== null).length ?? 0
  const wraps = keyring?.wraps ?? []

  return {
    status:
      keyring === null
        ? '読み込み中…'
        : initialized
          ? `設定済み。${enrolledCount} 個のパスキーで解錠できます。`
          : 'まだ設定していません。',
    lockNote: initialized
      ? unlocked
        ? ' いまは解錠中です。'
        : ' いまは施錠中です。'
      : null,
    loading: keyring === null,
    showWebAuthnNotice: !webAuthnAvailable,
    showSetup: !initialized,
    showUnlock: initialized && !unlocked,
    showUnlocked: initialized && unlocked,
    showWraps: wraps.length > 0,
    wraps,
  }
}
