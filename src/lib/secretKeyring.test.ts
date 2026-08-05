import { describe, expect, test } from 'vitest'
import { SecretDecryptError } from './secretEnvelope'
import {
  RECOVERY_KEY_LENGTH,
  checkVerifier,
  decodeRecoveryKey,
  deriveKek,
  encodeRecoveryKey,
  formatRecoveryKey,
  generateMasterKey,
  makeVerifier,
  unwrapMasterKey,
  wrapMasterKey,
} from './secretKeyring'

const CRED = 'credential-id-1'
const OTHER_CRED = 'credential-id-2'

// PRF 出力の模擬 (認証器が返す 32 バイト)
const prf = (seed: number) => new Uint8Array(32).fill(seed)

describe('generateMasterKey', () => {
  test('is 32 random bytes', async () => {
    const a = generateMasterKey()
    const b = generateMasterKey()
    expect(a.byteLength).toBe(32)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('deriveKek', () => {
  test('is deterministic for the same PRF output', async () => {
    const wrapped = await wrapMasterKey(await deriveKek(prf(7)), prf(1), CRED)
    const again = await unwrapMasterKey(await deriveKek(prf(7)), wrapped, CRED)
    expect(Array.from(again)).toEqual(Array.from(prf(1)))
  })

  test('differs per PRF output (別クレデンシャルでは開かない)', async () => {
    const wrapped = await wrapMasterKey(await deriveKek(prf(7)), prf(1), CRED)
    await expect(
      unwrapMasterKey(await deriveKek(prf(8)), wrapped, CRED),
    ).rejects.toBeInstanceOf(SecretDecryptError)
  })
})

describe('wrapMasterKey', () => {
  test('binds the wrap to the credential id (すり替え検知)', async () => {
    const kek = await deriveKek(prf(7))
    const wrapped = await wrapMasterKey(kek, prf(1), CRED)
    await expect(
      unwrapMasterKey(kek, wrapped, OTHER_CRED),
    ).rejects.toBeInstanceOf(SecretDecryptError)
  })
})

describe('verifier', () => {
  test('accepts the master key it was made from', async () => {
    const mk = generateMasterKey()
    expect(await checkVerifier(mk, await makeVerifier(mk))).toBe(true)
  })

  test('rejects a different master key (復旧キーの打ち間違い)', async () => {
    const verifier = await makeVerifier(generateMasterKey())
    expect(await checkVerifier(generateMasterKey(), verifier)).toBe(false)
  })

  test('rejects a corrupted verifier without throwing', async () => {
    const mk = generateMasterKey()
    expect(await checkVerifier(mk, new Uint8Array(3))).toBe(false)
  })
})

describe('recovery key', () => {
  test('round-trips a master key', () => {
    const mk = generateMasterKey()
    const decoded = decodeRecoveryKey(encodeRecoveryKey(mk))
    expect(decoded && Array.from(decoded)).toEqual(Array.from(mk))
  })

  test('is 52 base32 characters for 32 bytes', () => {
    expect(encodeRecoveryKey(generateMasterKey())).toHaveLength(
      RECOVERY_KEY_LENGTH,
    )
  })

  test('accepts the printed (hyphenated, lowercase) form', () => {
    const mk = generateMasterKey()
    const printed = formatRecoveryKey(encodeRecoveryKey(mk))
    expect(printed).toContain('-')
    const decoded = decodeRecoveryKey(printed.toLowerCase())
    expect(decoded && Array.from(decoded)).toEqual(Array.from(mk))
  })

  test('folds the letters people mistype (O→0, I/L→1)', () => {
    const mk = generateMasterKey()
    const encoded = encodeRecoveryKey(mk)
    const mistyped = encoded.replace(/0/g, 'O').replace(/1/g, 'I')
    const decoded = decodeRecoveryKey(mistyped)
    expect(decoded && Array.from(decoded)).toEqual(Array.from(mk))
  })

  test('rejects the wrong length or unknown letters', () => {
    expect(decodeRecoveryKey('abc')).toBe(null)
    expect(decodeRecoveryKey('!'.repeat(RECOVERY_KEY_LENGTH))).toBe(null)
  })
})
