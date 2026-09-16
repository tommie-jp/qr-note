import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PRF_SALT } from './keyring'
import {
  isWebAuthnAvailable,
  PrfUnsupportedError,
  requestPrf,
  SecretCancelledError,
} from './prf'

// 認証器から PRF 出力を貰う口 (docs/51-部分暗号化計画.md §6)。
// vitest は node 環境で window が無く、navigator にも credentials が無い
// (docs/96 §0)。両方を vi.stubGlobal で作り、get に渡った引数と返した値で
// 分岐を押さえる

// 認証器が返す 32 バイト (hmac-secret の出力に見立てる)
const OUTPUT = new Uint8Array(32).map((_, i) => i + 1)

// base64url の credential ID と、それを戻したバイト列
const CRED_PLAIN = 'AQID' // [1, 2, 3]
const CRED_URL_SAFE = '_-8' // '-' '_' を含む。[255, 239]
const CRED_BROKEN = '@@' // base64 として読めない

const DEFAULT_MESSAGE =
  'この環境ではパスキーから鍵を取り出せません (PRF 非対応)。復旧キーをお使いください'

const get = vi.fn<(options: CredentialRequestOptions) => Promise<Credential | null>>()

function stubWebAuthn(): void {
  vi.stubGlobal('window', { PublicKeyCredential: class {} })
  vi.stubGlobal('navigator', { credentials: { get } })
}

// PublicKeyCredential の作り物。DOM の型には PRF 拡張が無いので unknown 経由で名乗る
function assertion({
  id = 'cred-1',
  attachment = 'platform',
  extensions = { prf: { results: { first: OUTPUT.buffer } } },
}: {
  id?: string
  attachment?: 'platform' | 'cross-platform' | null
  extensions?: unknown
} = {}): PublicKeyCredential {
  return {
    id,
    type: 'public-key',
    authenticatorAttachment: attachment,
    getClientExtensionResults: () => extensions,
  } as unknown as PublicKeyCredential
}

// get に渡った publicKey の指定
function requestedOptions(): PublicKeyCredentialRequestOptions {
  const [options] = get.mock.calls[0] ?? []
  if (options?.publicKey === undefined) {
    throw new Error('navigator.credentials.get が publicKey 付きで呼ばれていない')
  }
  return options.publicKey
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('投げるはずが通った')
    },
    (cause: unknown) => cause,
  )
}

beforeEach(() => {
  get.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isWebAuthnAvailable', () => {
  test('window が無ければ false (サーバ・node)', () => {
    expect(isWebAuthnAvailable()).toBe(false)
  })

  test('window はあっても PublicKeyCredential が無ければ false', () => {
    vi.stubGlobal('window', {})

    expect(isWebAuthnAvailable()).toBe(false)
  })

  test('PublicKeyCredential があれば true', () => {
    stubWebAuthn()

    expect(isWebAuthnAvailable()).toBe(true)
  })
})

describe('requestPrf', () => {
  test('WebAuthn が無ければ認証器を呼ばずに断る', async () => {
    // Arrange — window 無し (stub しない)

    // Act
    const error = await failure(requestPrf([CRED_PLAIN]))

    // Assert
    expect(error).toBeInstanceOf(PrfUnsupportedError)
    expect(error).toMatchObject({
      name: 'PrfUnsupportedError',
      message: 'この環境ではパスキーを利用できません',
    })
    expect(get).not.toHaveBeenCalled()
  })

  describe('認証器へ渡す指定', () => {
    test('候補は base64url を戻したバイト列、本人確認は必須、PRF の salt は固定値', async () => {
      // Arrange
      stubWebAuthn()
      get.mockResolvedValueOnce(assertion())

      // Act
      await requestPrf([CRED_PLAIN, CRED_URL_SAFE])

      // Assert
      expect(get).toHaveBeenCalledTimes(1)
      const { challenge, ...rest } = requestedOptions()
      expect(rest).toEqual({
        allowCredentials: [
          { type: 'public-key', id: new Uint8Array([1, 2, 3]) },
          { type: 'public-key', id: new Uint8Array([255, 239]) },
        ],
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } },
      })
      expect(challenge).toBeInstanceOf(Uint8Array)
      expect((challenge as Uint8Array).byteLength).toBe(32)
    })

    // サーバへ送らない署名なので、チャレンジはクライアントが作る。
    // それでも使い回しはしない
    test('チャレンジは呼ぶたびに作り直す', async () => {
      // Arrange
      stubWebAuthn()
      get.mockResolvedValue(assertion())

      // Act
      await requestPrf([CRED_PLAIN])
      await requestPrf([CRED_PLAIN])

      // Assert
      const challenges = get.mock.calls.map(
        ([options]) => options.publicKey?.challenge as Uint8Array,
      )
      expect(Array.from(challenges[0])).not.toEqual(Array.from(challenges[1]))
    })

    test('候補を渡さなければ空で呼ぶ (この端末のパスキーから選ばせる)', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(assertion())

      await requestPrf()

      expect(requestedOptions().allowCredentials).toEqual([])
    })

    // 起こらないはずだが、黙って落とすと「登録したはずのパスキーが選択肢に
    // 出てこない」という原因の掴めない不具合になる。落とす事実だけは残す
    test('読めない credential ID はログに残してから外す (黙って落とさない)', async () => {
      // Arrange
      stubWebAuthn()
      get.mockResolvedValueOnce(assertion())
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      await requestPrf([CRED_BROKEN, CRED_PLAIN])

      // Assert
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(consoleError).toHaveBeenCalledWith(
        `credential ID を base64url として読めません: ${CRED_BROKEN}`,
      )
      expect(requestedOptions().allowCredentials).toEqual([
        { type: 'public-key', id: new Uint8Array([1, 2, 3]) },
      ])
    })
  })

  describe('認証器が投げたとき', () => {
    test('NotAllowedError は取り消し (失敗として扱わず、ログも残さない)', async () => {
      // Arrange
      stubWebAuthn()
      get.mockRejectedValueOnce(
        new DOMException('The operation either timed out or was not allowed', 'NotAllowedError'),
      )
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      const error = await failure(requestPrf([CRED_PLAIN]))

      // Assert
      expect(error).toBeInstanceOf(SecretCancelledError)
      expect(error).toMatchObject({
        name: 'SecretCancelledError',
        message: 'パスキーの操作が取り消されました',
      })
      expect(consoleError).not.toHaveBeenCalled()
    })

    test('それ以外の例外はログに残して PRF 非対応として断る', async () => {
      // Arrange
      stubWebAuthn()
      const cause = new DOMException('The security key is not registered', 'InvalidStateError')
      get.mockRejectedValueOnce(cause)
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Act
      const error = await failure(requestPrf([CRED_PLAIN]))

      // Assert
      expect(error).toBeInstanceOf(PrfUnsupportedError)
      expect(error).toMatchObject({ message: DEFAULT_MESSAGE })
      expect(consoleError).toHaveBeenCalledWith('認証器の呼び出しに失敗しました', cause)
    })
  })

  describe('認証器の返りが使えないとき', () => {
    test('null なら PRF 非対応として断る', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(null)

      const error = await failure(requestPrf([CRED_PLAIN]))

      expect(error).toBeInstanceOf(PrfUnsupportedError)
      expect(error).toMatchObject({ message: DEFAULT_MESSAGE })
    })

    test('getClientExtensionResults を持たない返りも断る', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce({ id: 'cred-1', type: 'public-key' } as Credential)

      const error = await failure(requestPrf([CRED_PLAIN]))

      expect(error).toBeInstanceOf(PrfUnsupportedError)
      expect(error).toMatchObject({ message: DEFAULT_MESSAGE })
    })

    // PRF に対応していない認証器・ブラウザはここで空になる。黙って別の鍵を
    // でっち上げず、復旧キーへ導く
    test('拡張の結果に prf が無ければ断る', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(assertion({ extensions: {} }))

      const error = await failure(requestPrf([CRED_PLAIN]))

      expect(error).toBeInstanceOf(PrfUnsupportedError)
      expect(error).toMatchObject({ message: DEFAULT_MESSAGE })
    })

    test('prf.enabled だけで results が無くても断る', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(assertion({ extensions: { prf: { enabled: true } } }))

      const error = await failure(requestPrf([CRED_PLAIN]))

      expect(error).toBeInstanceOf(PrfUnsupportedError)
      expect(error).toMatchObject({ message: DEFAULT_MESSAGE })
    })

    test('PRF の出力が空 (0 バイト) でも断る', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(
        assertion({ extensions: { prf: { results: { first: new ArrayBuffer(0) } } } }),
      )

      const error = await failure(requestPrf([CRED_PLAIN]))

      expect(error).toBeInstanceOf(PrfUnsupportedError)
      expect(error).toMatchObject({ message: DEFAULT_MESSAGE })
    })

    // QR (hybrid) で別の端末に委譲すると、認証は通るのに PRF の出力だけが
    // 返ってこない (iPad → iPhone の実機で確認。docs/51 §6)。「非対応」と
    // 出すと、この端末のパスキーなら開けることが伝わらないので文言を分ける
    test('出力が空で cross-platform 経由なら QR 委譲の文言で断る', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(
        assertion({ attachment: 'cross-platform', extensions: { prf: {} } }),
      )

      const error = await failure(requestPrf([CRED_PLAIN]))

      expect(error).toBeInstanceOf(PrfUnsupportedError)
      expect(error).toMatchObject({
        message:
          'QR で別の端末に委譲したパスキーからは鍵を取り出せません。この端末に保存されたパスキーを選ぶか、復旧キーをお使いください',
      })
    })

    test('出力が空でも platform 経由なら既定の文言 (QR の案内は出さない)', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(assertion({ attachment: 'platform', extensions: { prf: {} } }))

      const error = await failure(requestPrf([CRED_PLAIN]))

      expect(error).toMatchObject({ message: DEFAULT_MESSAGE })
    })

    // 出力があるなら経路は問わない (セキュリティキーの hmac-secret も cross-platform)
    test('cross-platform でも出力があれば通る', async () => {
      stubWebAuthn()
      get.mockResolvedValueOnce(assertion({ attachment: 'cross-platform' }))

      const result = await requestPrf([CRED_PLAIN])

      expect(Array.from(result.prfOutput)).toEqual(Array.from(OUTPUT))
    })
  })

  test('通れば応えた認証器の id と 32 バイトの出力を返す', async () => {
    // Arrange
    stubWebAuthn()
    get.mockResolvedValueOnce(assertion({ id: 'cred-answered' }))

    // Act
    const result = await requestPrf([CRED_PLAIN, CRED_URL_SAFE])

    // Assert
    expect(result.credentialId).toBe('cred-answered')
    expect(result.prfOutput).toBeInstanceOf(Uint8Array)
    expect(result.prfOutput.byteLength).toBe(32)
    expect(Array.from(result.prfOutput)).toEqual(Array.from(OUTPUT))
  })
})
