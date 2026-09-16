import { describe, expect, test } from 'vitest'
import type { KeyWrapInfo, KeyringState } from './api'
import { keyringView, type KeyringView } from './keyringView'

const wrap = (credentialId: string, enrolled: boolean): KeyWrapInfo => ({
  credentialId,
  label: `パスキー ${credentialId}`,
  wrapped: enrolled ? Uint8Array.from([1, 2, 3]) : null,
})

const keyring = (initialized: boolean, wraps: KeyWrapInfo[]): KeyringState => ({
  initialized,
  verifier: initialized ? Uint8Array.from([9]) : null,
  wraps,
})

const LOADING = null
const UNSET_NO_PASSKEY = keyring(false, [])
const UNSET_WITH_PASSKEY = keyring(false, [wrap('a', false)])
const SET_ONE_OF_TWO = keyring(true, [wrap('a', true), wrap('b', false)])
const SET_NONE_ENROLLED = keyring(true, [wrap('a', false)])

type Sections = Pick<
  KeyringView,
  'loading' | 'showSetup' | 'showUnlock' | 'showUnlocked' | 'showWraps'
>

// 出す節の組み合わせ。読み込み前 → 未設定 → 設定済み (施錠 / 解錠) の順
const TABLE: ReadonlyArray<{
  name: string
  keyring: KeyringState | null
  unlocked: boolean
  status: string
  lockNote: string | null
  sections: Sections
}> = [
  {
    name: '読み込み前 (施錠)',
    keyring: LOADING,
    unlocked: false,
    status: '読み込み中…',
    lockNote: null,
    sections: {
      loading: true,
      showSetup: true,
      showUnlock: false,
      showUnlocked: false,
      showWraps: false,
    },
  },
  {
    name: '読み込み前 (解錠済みでも節は増えない)',
    keyring: LOADING,
    unlocked: true,
    status: '読み込み中…',
    lockNote: null,
    sections: {
      loading: true,
      showSetup: true,
      showUnlock: false,
      showUnlocked: false,
      showWraps: false,
    },
  },
  {
    name: '未設定・パスキー無し',
    keyring: UNSET_NO_PASSKEY,
    unlocked: false,
    status: 'まだ設定していません。',
    lockNote: null,
    sections: {
      loading: false,
      showSetup: true,
      showUnlock: false,
      showUnlocked: false,
      showWraps: false,
    },
  },
  {
    name: '未設定・パスキーあり (一覧は出す)',
    keyring: UNSET_WITH_PASSKEY,
    unlocked: false,
    status: 'まだ設定していません。',
    lockNote: null,
    sections: {
      loading: false,
      showSetup: true,
      showUnlock: false,
      showUnlocked: false,
      showWraps: true,
    },
  },
  {
    name: '未設定なのに解錠済み (設定の節のまま)',
    keyring: UNSET_WITH_PASSKEY,
    unlocked: true,
    status: 'まだ設定していません。',
    lockNote: null,
    sections: {
      loading: false,
      showSetup: true,
      showUnlock: false,
      showUnlocked: false,
      showWraps: true,
    },
  },
  {
    name: '設定済み・施錠中 (2 本のうち 1 本で解錠できる)',
    keyring: SET_ONE_OF_TWO,
    unlocked: false,
    status: '設定済み。1 個のパスキーで解錠できます。',
    lockNote: ' いまは施錠中です。',
    sections: {
      loading: false,
      showSetup: false,
      showUnlock: true,
      showUnlocked: false,
      showWraps: true,
    },
  },
  {
    name: '設定済み・解錠中',
    keyring: SET_ONE_OF_TWO,
    unlocked: true,
    status: '設定済み。1 個のパスキーで解錠できます。',
    lockNote: ' いまは解錠中です。',
    sections: {
      loading: false,
      showSetup: false,
      showUnlock: false,
      showUnlocked: true,
      showWraps: true,
    },
  },
  {
    name: '設定済み・この端末の包みが無い・復旧キーで解錠中',
    keyring: SET_NONE_ENROLLED,
    unlocked: true,
    status: '設定済み。0 個のパスキーで解錠できます。',
    lockNote: ' いまは解錠中です。',
    sections: {
      loading: false,
      showSetup: false,
      showUnlock: false,
      showUnlocked: true,
      showWraps: true,
    },
  },
  {
    name: '設定済み・この端末の包みが無い・施錠中 (解錠の節は出す)',
    keyring: SET_NONE_ENROLLED,
    unlocked: false,
    status: '設定済み。0 個のパスキーで解錠できます。',
    lockNote: ' いまは施錠中です。',
    sections: {
      loading: false,
      showSetup: false,
      showUnlock: true,
      showUnlocked: false,
      showWraps: true,
    },
  },
]

describe('keyringView', () => {
  test.each(TABLE)('$name', ({ keyring, unlocked, status, lockNote, sections }) => {
    const view = keyringView({ keyring, unlocked, webAuthnAvailable: true })

    expect(view.status).toBe(status)
    expect(view.lockNote).toBe(lockNote)
    expect({
      loading: view.loading,
      showSetup: view.showSetup,
      showUnlock: view.showUnlock,
      showUnlocked: view.showUnlocked,
      showWraps: view.showWraps,
    }).toEqual(sections)
  })

  // 解錠の節と解錠中の節は排他。設定済みならどちらか一方が必ず出る
  test('設定済みなら 解錠する と 解錠中の節 のどちらか一方だけが出る', () => {
    for (const state of TABLE) {
      const view = keyringView({ ...state, webAuthnAvailable: true })

      expect(view.showUnlock && view.showUnlocked).toBe(false)
      expect(view.showUnlock || view.showUnlocked).toBe(!view.showSetup)
    }
  })

  // 注意は「パスキーが使えるか」だけで決まる。他の状態には左右されない
  test('パスキーが使えない環境では、どの状態でも注意を出す', () => {
    for (const state of TABLE) {
      const available = keyringView({ ...state, webAuthnAvailable: true })
      const unavailable = keyringView({ ...state, webAuthnAvailable: false })

      expect(available.showWebAuthnNotice).toBe(false)
      expect(unavailable.showWebAuthnNotice).toBe(true)
      expect({ ...unavailable, showWebAuthnNotice: false }).toEqual(available)
    }
  })

  test('一覧は鍵束の wraps をそのまま (順序も) 渡す', () => {
    const view = keyringView({
      keyring: SET_ONE_OF_TWO,
      unlocked: false,
      webAuthnAvailable: true,
    })

    expect(view.wraps).toBe(SET_ONE_OF_TWO.wraps)
    expect(view.wraps.map((w) => w.credentialId)).toEqual(['a', 'b'])
  })

  test('読み込み前の一覧は空', () => {
    const view = keyringView({
      keyring: LOADING,
      unlocked: false,
      webAuthnAvailable: true,
    })

    expect(view.wraps).toEqual([])
  })
})
