import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SecretApiError, type KeyringState } from './api'
import { SecretDecryptError } from './envelope'
import {
  checkVerifier,
  decodeRecoveryKey,
  deriveKek,
  encodeRecoveryKey,
  formatRecoveryKey,
  generateMasterKey,
  makeVerifier,
  unwrapMasterKey,
  wrapMasterKey,
} from './keyring'
import { type PrfAssertion, SecretCancelledError } from './prf'
import { isUnlocked, lockSecrets, unlockedMasterKeyBytes, unlockWith } from './session'
import {
  enrollThisDevice,
  SecretSetupError,
  setupSecrets,
  unlockWithPasskey,
  unlockWithRecoveryKey,
} from './unlock'

// 鍵束の設定・解錠の手順 (docs/51-部分暗号化計画.md §6)。
//
// 差し替えるのは口 (api)・認証器 (prf)・端末の写し (offline/keyring) の 3 つだけ。
// keyring・session・WebCrypto は本物を使い、**手順が作った包みを本物の手順で
// 開き直して、元のマスターキーに戻ること**を確かめる (docs/96 §2-3)
const mocks = vi.hoisted(() => ({
  fetchKeyring: vi.fn<() => Promise<KeyringState>>(),
  initKeyring: vi.fn<
    (verifier: Uint8Array, credentialId: string, wrapped: Uint8Array) => Promise<void>
  >(),
  saveKeyWrap: vi.fn<(credentialId: string, wrapped: Uint8Array) => Promise<void>>(),
  requestPrf: vi.fn<(allowCredentialIds?: readonly string[]) => Promise<PrfAssertion>>(),
  loadKeyringCache: vi.fn<() => Promise<KeyringState | null>>(),
  saveKeyringCache: vi.fn<(state: KeyringState) => Promise<void>>(),
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  fetchKeyring: mocks.fetchKeyring,
  initKeyring: mocks.initKeyring,
  saveKeyWrap: mocks.saveKeyWrap,
}))

vi.mock('./prf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./prf')>()),
  requestPrf: mocks.requestPrf,
}))

vi.mock('../offline/keyring', () => ({
  loadKeyringCache: mocks.loadKeyringCache,
  saveKeyringCache: mocks.saveKeyringCache,
}))

// 包みを持つパスキー (iPhone) と、まだ持たないパスキー (Windows)
const CRED_ENROLLED = 'cred-iphone'
const CRED_PENDING = 'cred-windows'

// 認証器が返す PRF 出力の模擬 (クレデンシャルごとに違う 32 バイト)
const prf = (seed: number) => new Uint8Array(32).fill(seed)
const PRF_ENROLLED = prf(7)
const PRF_PENDING = prf(8)

const NOT_INITIALIZED = '暗号化がまだ設定されていません。設定画面から始めてください'

// 圏外 (api/envelope.ts の apiFetch が status 0 で投げる形)
const offline = () => new SecretApiError('通信に失敗しました。電波の状態を確認してください', 0)

// 未設定の鍵束。パスキーは登録済みだが包みは無い
function emptyKeyring(): KeyringState {
  return {
    initialized: false,
    verifier: null,
    wraps: [
      { credentialId: CRED_ENROLLED, label: 'iPhone', wrapped: null },
      { credentialId: CRED_PENDING, label: 'Windows', wrapped: null },
    ],
  }
}

// 設定済みの鍵束。iPhone のパスキーだけが包みを持つ
async function keyringFor(masterKey: Uint8Array): Promise<KeyringState> {
  return {
    initialized: true,
    verifier: await makeVerifier(masterKey),
    wraps: [
      {
        credentialId: CRED_ENROLLED,
        label: 'iPhone',
        wrapped: await wrapMasterKey(await deriveKek(PRF_ENROLLED), masterKey, CRED_ENROLLED),
      },
      { credentialId: CRED_PENDING, label: 'Windows', wrapped: null },
    ],
  }
}

const answeredBy = (credentialId: string, prfOutput: Uint8Array): PrfAssertion => ({
  credentialId,
  prfOutput,
})

const bytes = (value: Uint8Array | null) => (value === null ? null : Array.from(value))

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('投げるはずが通った')
    },
    (cause: unknown) => cause,
  )
}

let consoleWarn: ReturnType<typeof vi.spyOn>
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  lockSecrets()
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  mocks.initKeyring.mockResolvedValue(undefined)
  mocks.saveKeyWrap.mockResolvedValue(undefined)
  mocks.saveKeyringCache.mockResolvedValue(undefined)
  mocks.loadKeyringCache.mockResolvedValue(null)
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  lockSecrets()
  vi.restoreAllMocks()
})

describe('setupSecrets', () => {
  test('設定済みなら認証器を呼ばずに断る', async () => {
    // Arrange
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(generateMasterKey()))

    // Act
    const error = await failure(setupSecrets())

    // Assert
    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({
      name: 'SecretSetupError',
      message: '暗号化は既に設定されています',
    })
    expect(mocks.requestPrf).not.toHaveBeenCalled()
    expect(mocks.initKeyring).not.toHaveBeenCalled()
    expect(isUnlocked()).toBe(false)
  })

  test('検証値と包みを保存し、解錠済みにして、同じ鍵に戻る復旧キーを返す', async () => {
    // Arrange — 設定の後にもう一度読む鍵束 (写しの更新に使われる) は別の値にして見分ける
    const afterSetup = await keyringFor(generateMasterKey())
    mocks.fetchKeyring.mockResolvedValueOnce(emptyKeyring()).mockResolvedValueOnce(afterSetup)
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_ENROLLED, PRF_ENROLLED))

    // Act
    const recoveryKey = await setupSecrets()

    // Assert — 候補は登録済みの全パスキー (包みはまだ無い)
    expect(mocks.requestPrf).toHaveBeenCalledWith([CRED_ENROLLED, CRED_PENDING])

    // 解錠済みで、その鍵が正
    expect(isUnlocked()).toBe(true)
    const masterKey = unlockedMasterKeyBytes()
    expect(masterKey?.byteLength).toBe(32)

    // 保存した検証値はその鍵で通り、包みは本物の手順で元の鍵に戻る
    expect(mocks.initKeyring).toHaveBeenCalledTimes(1)
    const [verifier, credentialId, wrapped] = mocks.initKeyring.mock.calls[0]
    expect(credentialId).toBe(CRED_ENROLLED)
    expect(await checkVerifier(masterKey as Uint8Array, verifier)).toBe(true)
    const unwrapped = await unwrapMasterKey(await deriveKek(PRF_ENROLLED), wrapped, CRED_ENROLLED)
    expect(bytes(unwrapped)).toEqual(bytes(masterKey))

    // 復旧キーは印字の形 (区切りあり) で、同じ鍵に戻る
    expect(recoveryKey).toContain('-')
    expect(bytes(decodeRecoveryKey(recoveryKey))).toEqual(bytes(masterKey))

    // 写しは「サーバが返した形」で更新する (手で組み立てない)
    expect(mocks.saveKeyringCache).toHaveBeenCalledTimes(1)
    expect(mocks.saveKeyringCache).toHaveBeenCalledWith(afterSetup)
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  // 「鍵を作った後で認証器を呼ぶ」順序の裏付け。取り消されたらサーバには何も残らない
  test('認証器で取り消されたらサーバには何も書かず、施錠のまま', async () => {
    // Arrange
    mocks.fetchKeyring.mockResolvedValueOnce(emptyKeyring())
    mocks.requestPrf.mockRejectedValueOnce(new SecretCancelledError())

    // Act
    const error = await failure(setupSecrets())

    // Assert
    expect(error).toBeInstanceOf(SecretCancelledError)
    expect(mocks.initKeyring).not.toHaveBeenCalled()
    expect(mocks.saveKeyringCache).not.toHaveBeenCalled()
    expect(isUnlocked()).toBe(false)
  })

  test('写しの更新に失敗しても設定は成立する (警告だけ残す)', async () => {
    // Arrange
    const cause = offline()
    mocks.fetchKeyring.mockResolvedValueOnce(emptyKeyring()).mockRejectedValueOnce(cause)
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_ENROLLED, PRF_ENROLLED))

    // Act
    const recoveryKey = await setupSecrets()

    // Assert
    expect(decodeRecoveryKey(recoveryKey)).not.toBe(null)
    expect(isUnlocked()).toBe(true)
    expect(mocks.saveKeyringCache).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith('鍵束の写しを更新できませんでした', cause)
  })
})

describe('unlockWithPasskey', () => {
  test('未設定なら設定画面へ案内する (認証器は呼ばない)', async () => {
    mocks.fetchKeyring.mockResolvedValueOnce(emptyKeyring())

    const error = await failure(unlockWithPasskey())

    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({ message: NOT_INITIALIZED })
    expect(mocks.requestPrf).not.toHaveBeenCalled()
  })

  test('包みを持つパスキーが 1 つも無ければ復旧キーへ案内する', async () => {
    // Arrange — 設定済みだが、どのパスキーも包みを持たない
    const keyring = await keyringFor(generateMasterKey())
    mocks.fetchKeyring.mockResolvedValueOnce({
      ...keyring,
      wraps: keyring.wraps.map((wrap) => ({ ...wrap, wrapped: null })),
    })

    // Act
    const error = await failure(unlockWithPasskey())

    // Assert
    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({
      message: 'どのパスキーでも暗号化が有効になっていません。復旧キーで解錠してください',
    })
    expect(mocks.requestPrf).not.toHaveBeenCalled()
  })

  // 持たないものを選ばれても開けないので、認証器の側で選ばせない
  test('候補は包みを持つパスキーだけ', async () => {
    // Arrange
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(generateMasterKey()))
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_ENROLLED, PRF_ENROLLED))

    // Act
    await unlockWithPasskey()

    // Assert
    expect(mocks.requestPrf).toHaveBeenCalledTimes(1)
    expect(mocks.requestPrf).toHaveBeenCalledWith([CRED_ENROLLED])
  })

  // allowCredentials を無視する認証器がある。そのパスキーで有効にすれば
  // 次から使えるので、そう案内する
  test('包みを持たないパスキーで応えられたら設定画面へ案内する', async () => {
    // Arrange
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(generateMasterKey()))
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_PENDING, PRF_PENDING))

    // Act
    const error = await failure(unlockWithPasskey())

    // Assert
    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({
      message: 'このパスキーでは暗号化が有効になっていません。設定画面から有効にしてください',
    })
    expect(isUnlocked()).toBe(false)
  })

  test('包みを開いて元のマスターキーで解錠する', async () => {
    // Arrange
    const masterKey = generateMasterKey()
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(masterKey))
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_ENROLLED, PRF_ENROLLED))

    // Act
    await unlockWithPasskey()

    // Assert
    expect(isUnlocked()).toBe(true)
    expect(bytes(unlockedMasterKeyBytes())).toEqual(bytes(masterKey))
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('別の PRF 出力 (別の鍵) では包みが開かず、施錠のまま', async () => {
    // Arrange — 同じ credential ID を名乗るが、出力が違う
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(generateMasterKey()))
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_ENROLLED, PRF_PENDING))

    // Act
    const error = await failure(unlockWithPasskey())

    // Assert
    expect(error).toBeInstanceOf(SecretDecryptError)
    expect(isUnlocked()).toBe(false)
    expect(unlockedMasterKeyBytes()).toBe(null)
  })
})

describe('unlockWithRecoveryKey', () => {
  const printed = (masterKey: Uint8Array) => formatRecoveryKey(encodeRecoveryKey(masterKey))

  test('未設定なら設定画面へ案内する', async () => {
    mocks.fetchKeyring.mockResolvedValueOnce(emptyKeyring())

    const error = await failure(unlockWithRecoveryKey(printed(generateMasterKey())))

    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({ message: NOT_INITIALIZED })
  })

  test('形式が違えば検算の前に断る', async () => {
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(generateMasterKey()))

    const error = await failure(unlockWithRecoveryKey('abc'))

    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({ message: '復旧キーの形式が違います' })
    expect(isUnlocked()).toBe(false)
  })

  // 検証値が壊れて読めなかった (api.ts の decodeKey が null にした) 鍵束。
  // 検算できない鍵で解錠してしまうと、以後の保存が「開けない断片」を作り続ける
  test('検証値が無ければ正しいキーでも断る', async () => {
    // Arrange
    const masterKey = generateMasterKey()
    mocks.fetchKeyring.mockResolvedValueOnce({ ...(await keyringFor(masterKey)), verifier: null })

    // Act
    const error = await failure(unlockWithRecoveryKey(printed(masterKey)))

    // Assert
    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({ message: '復旧キーが違います' })
    expect(isUnlocked()).toBe(false)
  })

  test('検証値と合わないキー (打ち間違い) は断る', async () => {
    // Arrange
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(generateMasterKey()))

    // Act
    const error = await failure(unlockWithRecoveryKey(printed(generateMasterKey())))

    // Assert
    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({ message: '復旧キーが違います' })
    expect(isUnlocked()).toBe(false)
    // 打ち間違いは想定内。開発者向けのログも出ない
    expect(consoleError).not.toHaveBeenCalled()
  })

  test('検証値と合えば解錠する (認証器は呼ばない)', async () => {
    // Arrange
    const masterKey = generateMasterKey()
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(masterKey))

    // Act
    await unlockWithRecoveryKey(printed(masterKey).toLowerCase())

    // Assert
    expect(isUnlocked()).toBe(true)
    expect(bytes(unlockedMasterKeyBytes())).toEqual(bytes(masterKey))
    expect(mocks.requestPrf).not.toHaveBeenCalled()
  })
})

describe('enrollThisDevice', () => {
  test('施錠中は鍵束を読む前に断る', async () => {
    const error = await failure(enrollThisDevice())

    expect(error).toBeInstanceOf(SecretSetupError)
    expect(error).toMatchObject({ message: '先に解錠してください' })
    expect(mocks.fetchKeyring).not.toHaveBeenCalled()
    expect(mocks.requestPrf).not.toHaveBeenCalled()
  })

  test('応えたパスキーの鍵で包み直して保存し、その後で写しを更新する', async () => {
    // Arrange — 復旧キー経路などで解錠済み
    const masterKey = generateMasterKey()
    await unlockWith(masterKey)
    const before = await keyringFor(masterKey)
    const after = await keyringFor(masterKey)
    mocks.fetchKeyring.mockResolvedValueOnce(before).mockResolvedValueOnce(after)
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_PENDING, PRF_PENDING))

    // Act
    await enrollThisDevice()

    // Assert — 候補は包みの有無を問わず全パスキー (これから包むのだから)
    expect(mocks.requestPrf).toHaveBeenCalledWith([CRED_ENROLLED, CRED_PENDING])

    // 保存した包みは、そのパスキーの PRF 出力で元の鍵に戻る
    expect(mocks.saveKeyWrap).toHaveBeenCalledTimes(1)
    const [credentialId, wrapped] = mocks.saveKeyWrap.mock.calls[0]
    expect(credentialId).toBe(CRED_PENDING)
    const unwrapped = await unwrapMasterKey(await deriveKek(PRF_PENDING), wrapped, CRED_PENDING)
    expect(bytes(unwrapped)).toEqual(bytes(masterKey))

    // 写しは保存の後に、サーバが返した形で更新する。これが無いと、有効にした
    // 端末が圏外へ出た途端に「このパスキーでは有効になっていません」に戻る
    expect(mocks.saveKeyringCache).toHaveBeenLastCalledWith(after)
    const savedAt = mocks.saveKeyWrap.mock.invocationCallOrder[0]
    const refreshedAt = mocks.saveKeyringCache.mock.invocationCallOrder.at(-1)
    expect(refreshedAt).toBeGreaterThan(savedAt)
    expect(isUnlocked()).toBe(true)
  })

  test('写しの更新に失敗しても包みの保存は成立する (警告だけ残す)', async () => {
    // Arrange
    const masterKey = generateMasterKey()
    await unlockWith(masterKey)
    mocks.fetchKeyring.mockResolvedValue(await keyringFor(masterKey))
    mocks.requestPrf.mockResolvedValueOnce(answeredBy(CRED_PENDING, PRF_PENDING))
    const cause = new Error('QuotaExceededError')
    // 1 回目は readKeyring の写し (成功)、2 回目が refreshKeyringCache の写し (失敗)
    mocks.saveKeyringCache.mockResolvedValueOnce(undefined).mockRejectedValueOnce(cause)

    // Act
    await enrollThisDevice()

    // Assert
    expect(mocks.saveKeyWrap).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith('鍵束の写しを更新できませんでした', cause)
  })
})

// 鍵束の読み方 (readKeyring)。サーバを先に見て、駄目なら端末の写しへ落ちる
// (docs/65-オフライン対応計画.md §9)。復旧キー経路で入口から確かめる
describe('鍵束の読み方 (サーバ → 写し)', () => {
  const printed = (masterKey: Uint8Array) => formatRecoveryKey(encodeRecoveryKey(masterKey))

  test('サーバが答えたら写しを書き直す (写しは読まない)', async () => {
    // Arrange
    const masterKey = generateMasterKey()
    const keyring = await keyringFor(masterKey)
    mocks.fetchKeyring.mockResolvedValueOnce(keyring)

    // Act
    await unlockWithRecoveryKey(printed(masterKey))

    // Assert
    expect(mocks.saveKeyringCache).toHaveBeenCalledTimes(1)
    expect(mocks.saveKeyringCache).toHaveBeenCalledWith(keyring)
    expect(mocks.loadKeyringCache).not.toHaveBeenCalled()
    expect(isUnlocked()).toBe(true)
  })

  test('写しの保存に失敗しても解錠は進む (警告だけ残す)', async () => {
    // Arrange
    const masterKey = generateMasterKey()
    mocks.fetchKeyring.mockResolvedValueOnce(await keyringFor(masterKey))
    const cause = new Error('この環境では IndexedDB を使えません')
    mocks.saveKeyringCache.mockRejectedValueOnce(cause)

    // Act
    await unlockWithRecoveryKey(printed(masterKey))

    // Assert
    expect(isUnlocked()).toBe(true)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith('鍵束を端末に保存できませんでした', cause)
  })

  // 順番が逆ではいけない。写しを先に使うと、別の端末でパスキーを足した直後に
  // 「有効になっていません」と断られる。サーバが答えられるなら常にそちらが正
  test('サーバが失敗したら写しで解錠する', async () => {
    // Arrange
    const masterKey = generateMasterKey()
    mocks.fetchKeyring.mockRejectedValueOnce(offline())
    mocks.loadKeyringCache.mockResolvedValueOnce(await keyringFor(masterKey))

    // Act
    await unlockWithRecoveryKey(printed(masterKey))

    // Assert
    expect(isUnlocked()).toBe(true)
    expect(bytes(unlockedMasterKeyBytes())).toEqual(bytes(masterKey))
    // 写しから読んだときは写しを書き直さない (古い写しで上書きしない)
    expect(mocks.saveKeyringCache).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  // 「圏外だから解錠できない」と「鍵束が壊れている」は利用者にできることが違う
  test('サーバが失敗して写しも無ければ、サーバの失敗をそのまま投げる', async () => {
    // Arrange
    const cause = offline()
    mocks.fetchKeyring.mockRejectedValueOnce(cause)
    mocks.loadKeyringCache.mockResolvedValueOnce(null)

    // Act
    const error = await failure(unlockWithRecoveryKey(printed(generateMasterKey())))

    // Assert
    expect(error).toBe(cause)
    expect(isUnlocked()).toBe(false)
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  test('写しの読み込みまで失敗したら警告を残し、やはりサーバの失敗を投げる', async () => {
    // Arrange
    const cause = offline()
    const cacheFailure = new Error('IndexedDB の要求が失敗しました')
    mocks.fetchKeyring.mockRejectedValueOnce(cause)
    mocks.loadKeyringCache.mockRejectedValueOnce(cacheFailure)

    // Act
    const error = await failure(unlockWithRecoveryKey(printed(generateMasterKey())))

    // Assert
    expect(error).toBe(cause)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledWith('端末の鍵束を読めませんでした', cacheFailure)
  })
})
