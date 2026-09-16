import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  SecretLockedError,
  loadSecret,
  newSecretName,
  saveSecretMedia,
  saveSecretText,
  secretContext,
  secretText,
} from './content'
import {
  SecretDecryptError,
  importContentKey,
  openSecret,
  sealSecret,
} from './envelope'
import { SECRET_TEXT_MIME } from './payload'
import { lockSecrets, unlockWith } from './session'

// 読み書きの層 (docs/51 §8, §9)。差し替えるのは通信 (./api) と端末の写しの
// 掃除 (../offline/cacheNames) だけで、封と開封は本物の WebCrypto で往復させる
const mocks = vi.hoisted(() => ({
  fetchSecretBlob: vi.fn(),
  saveSecret: vi.fn(),
  forgetCachedUrl: vi.fn(),
}))

vi.mock('./api', () => ({
  fetchSecretBlob: mocks.fetchSecretBlob,
  saveSecret: mocks.saveSecret,
}))

vi.mock('../offline/cacheNames', () => ({
  forgetCachedUrl: mocks.forgetCachedUrl,
}))

const NAME = '0123abcd-4567-89ab-cdef-0123456789ab'
const OTHER = 'fedcba98-7654-3210-fedc-ba9876543210'

const RAW_KEY = new Uint8Array(32).fill(3)
const key = () => importContentKey(RAW_KEY)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// 断片の AAD は「名前 + 復号後の種別」。mime は暗号化しないメタデータなので、
// DB に書ける相手は data をそのままに mime だけを書き換えられる。両方を
// 縛っていないと、そのすり替えが復号成功として通ってしまう (docs/51 §7)。
describe('secretContext', () => {
  test('a blob keeps opening under its own name and mime', async () => {
    const k = await key()
    const context = secretContext(NAME, SECRET_TEXT_MIME)
    const sealed = await sealSecret(k, new Uint8Array([1, 2, 3]), context)
    expect(Array.from(await openSecret(k, sealed, context))).toEqual([1, 2, 3])
  })

  test('rejects a blob whose mime was swapped (画像を markdown と偽る)', async () => {
    const k = await key()
    const sealed = await sealSecret(
      k,
      new Uint8Array([1, 2, 3]),
      secretContext(NAME, 'image/png'),
    )
    await expect(
      openSecret(k, sealed, secretContext(NAME, SECRET_TEXT_MIME)),
    ).rejects.toBeInstanceOf(SecretDecryptError)
  })

  test('rejects a blob whose name was swapped', async () => {
    const k = await key()
    const sealed = await sealSecret(
      k,
      new Uint8Array([1, 2, 3]),
      secretContext(NAME, SECRET_TEXT_MIME),
    )
    await expect(
      openSecret(k, sealed, secretContext(OTHER, SECRET_TEXT_MIME)),
    ).rejects.toBeInstanceOf(SecretDecryptError)
  })
})

describe('newSecretName', () => {
  test('保存より先に決める名前は v4 の UUID で、呼ぶたびに違う', () => {
    const first = newSecretName()
    const second = newSecretName()

    expect(first).toMatch(UUID_V4)
    expect(second).toMatch(UUID_V4)
    expect(first).not.toBe(second)
  })
})

describe('secretText', () => {
  test('復号済みのバイト列を UTF-8 の文字列にする', () => {
    const bytes = new TextEncoder().encode('ひみつ 🔒')

    expect(secretText({ mime: SECRET_TEXT_MIME, bytes })).toBe('ひみつ 🔒')
  })
})

describe('鍵を使う読み書き', () => {
  beforeEach(async () => {
    mocks.fetchSecretBlob.mockReset()
    mocks.saveSecret.mockReset().mockResolvedValue(undefined)
    mocks.forgetCachedUrl.mockReset().mockResolvedValue(undefined)
    await unlockWith(RAW_KEY)
  })

  afterEach(() => {
    lockSecrets()
  })

  describe('施錠中', () => {
    beforeEach(() => {
      lockSecrets()
    })

    test('読みも書きも SecretLockedError で断り、通信しない', async () => {
      await expect(loadSecret(NAME)).rejects.toBeInstanceOf(SecretLockedError)
      await expect(saveSecretText(NAME, 'x')).rejects.toBeInstanceOf(SecretLockedError)
      await expect(
        saveSecretMedia(NAME, 'image/png', new Uint8Array([1])),
      ).rejects.toBeInstanceOf(SecretLockedError)

      expect(mocks.fetchSecretBlob).not.toHaveBeenCalled()
      expect(mocks.saveSecret).not.toHaveBeenCalled()
    })

    test('SecretLockedError は画面に出す文言と名前を持つ', () => {
      const error = new SecretLockedError()

      expect(error.message).toBe('シークレットが施錠されています')
      expect(error.name).toBe('SecretLockedError')
    })
  })

  describe('saveSecretText', () => {
    test('本文を markdown として封をして保存し、送るのは暗号文だけ', async () => {
      // Act
      await saveSecretText(NAME, 'ひみつの本文')

      // Assert: 平文は送らない。自分の鍵と文脈で開けば元に戻る
      expect(mocks.saveSecret).toHaveBeenCalledTimes(1)
      const [name, mime, sealed] = mocks.saveSecret.mock.calls[0]
      expect(name).toBe(NAME)
      expect(mime).toBe(SECRET_TEXT_MIME)
      const plain = new TextEncoder().encode('ひみつの本文')
      expect(Buffer.from(sealed).includes(Buffer.from(plain))).toBe(false)
      const opened = await openSecret(await key(), sealed, secretContext(NAME, SECRET_TEXT_MIME))
      expect(new TextDecoder().decode(opened)).toBe('ひみつの本文')
    })

    test('保存の後に端末の旧い写しを捨てる (順番が逆だと失敗時に写しだけ失う)', async () => {
      await saveSecretText(NAME, 'x')

      expect(mocks.forgetCachedUrl).toHaveBeenCalledWith(`/api/secrets/${NAME}`)
      expect(mocks.saveSecret.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.forgetCachedUrl.mock.invocationCallOrder[0],
      )
    })

    test('保存が失敗したら写しは捨てない', async () => {
      mocks.saveSecret.mockRejectedValue(new Error('通信に失敗しました'))

      await expect(saveSecretText(NAME, 'x')).rejects.toThrow('通信に失敗しました')

      expect(mocks.forgetCachedUrl).not.toHaveBeenCalled()
    })
  })

  describe('saveSecretMedia', () => {
    test('MediaRecorder のパラメータを落とした mime で封をし、その mime を返す', async () => {
      // Act
      const mime = await saveSecretMedia(NAME, 'Audio/WebM; codecs=opus', new Uint8Array([7, 8, 9]))

      // Assert: AAD に縛る mime と送る mime が同じ (docs/53 §3)
      expect(mime).toBe('audio/webm')
      const [, sentMime, sealed] = mocks.saveSecret.mock.calls[0]
      expect(sentMime).toBe('audio/webm')
      const opened = await openSecret(await key(), sealed, secretContext(NAME, 'audio/webm'))
      expect(Array.from(opened)).toEqual([7, 8, 9])
    })

    test.each([
      ['本文の種別', SECRET_TEXT_MIME],
      ['知らない種別', 'application/zip'],
    ])('%s は媒体として受けない', async (_label, mime) => {
      await expect(saveSecretMedia(NAME, mime, new Uint8Array([1]))).rejects.toThrow(
        'この形式はシークレットにできません',
      )
      expect(mocks.saveSecret).not.toHaveBeenCalled()
    })
  })

  describe('loadSecret', () => {
    async function sealedBlob(mime: string, bytes: Uint8Array, name = NAME) {
      return {
        mime,
        bytes: await sealSecret(await key(), bytes, secretContext(name, mime)),
      }
    }

    test('取ってきた断片を開けて、種別と平文を返す', async () => {
      const plain = new TextEncoder().encode('本文')
      mocks.fetchSecretBlob.mockResolvedValue(await sealedBlob(SECRET_TEXT_MIME, plain))

      const content = await loadSecret(NAME)

      expect(mocks.fetchSecretBlob).toHaveBeenCalledWith(NAME)
      expect(content.mime).toBe(SECRET_TEXT_MIME)
      expect(secretText(content)).toBe('本文')
    })

    test('サーバが知らない種別を返したら開けずに断る', async () => {
      mocks.fetchSecretBlob.mockResolvedValue({
        mime: 'application/zip',
        bytes: new Uint8Array([1, 2, 3]),
      })

      await expect(loadSecret(NAME)).rejects.toThrow('未知の種類のシークレットです')
    })

    test('種別を書き換えられた断片は、空を返さず復号の失敗として投げる', async () => {
      const sealed = await sealedBlob('image/png', new Uint8Array([1, 2, 3]))
      mocks.fetchSecretBlob.mockResolvedValue({ ...sealed, mime: SECRET_TEXT_MIME })

      await expect(loadSecret(NAME)).rejects.toBeInstanceOf(SecretDecryptError)
    })

    test('別の名前の断片を差し込まれても開かない', async () => {
      mocks.fetchSecretBlob.mockResolvedValue(
        await sealedBlob(SECRET_TEXT_MIME, new Uint8Array([1]), OTHER),
      )

      await expect(loadSecret(NAME)).rejects.toBeInstanceOf(SecretDecryptError)
    })
  })
})
