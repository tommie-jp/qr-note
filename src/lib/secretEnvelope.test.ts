import { describe, expect, test } from 'vitest'
import {
  ENVELOPE_VERSION,
  SecretDecryptError,
  importContentKey,
  openSecret,
  sealSecret,
} from './secretEnvelope'

const NAME = '0123abcd-4567-89ab-cdef-0123456789ab'
const OTHER = 'fedcba98-7654-3210-fedc-ba9876543210'

async function key(seed = 1): Promise<CryptoKey> {
  return importContentKey(new Uint8Array(32).fill(seed))
}

const text = (value: string) => new TextEncoder().encode(value)
const read = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('sealSecret / openSecret', () => {
  test('round-trips the plaintext', async () => {
    const k = await key()
    const sealed = await sealSecret(k, text('住所は東京'), NAME)
    expect(read(await openSecret(k, sealed, NAME))).toBe('住所は東京')
  })

  test('never contains the plaintext bytes', async () => {
    const sealed = await sealSecret(await key(), text('P@ssw0rd'), NAME)
    expect(read(sealed).includes('P@ssw0rd')).toBe(false)
  })

  test('starts with the version byte and a 12-byte iv', async () => {
    const sealed = await sealSecret(await key(), text('x'), NAME)
    expect(sealed[0]).toBe(ENVELOPE_VERSION)
    // version(1) + iv(12) + 暗号文(1) + GCM タグ(16)
    expect(sealed.byteLength).toBe(1 + 12 + 1 + 16)
  })

  test('uses a fresh iv every time (同じ平文でも暗号文が変わる)', async () => {
    const k = await key()
    const a = await sealSecret(k, text('same'), NAME)
    const b = await sealSecret(k, text('same'), NAME)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('rejects a blob sealed under a different name (すり替え検知)', async () => {
    const k = await key()
    const sealed = await sealSecret(k, text('銀行のパスワード'), NAME)
    await expect(openSecret(k, sealed, OTHER)).rejects.toBeInstanceOf(
      SecretDecryptError,
    )
  })

  test('rejects a blob sealed under a different key', async () => {
    const sealed = await sealSecret(await key(1), text('x'), NAME)
    await expect(openSecret(await key(2), sealed, NAME)).rejects.toBeInstanceOf(
      SecretDecryptError,
    )
  })

  test('rejects a tampered ciphertext', async () => {
    const k = await key()
    const sealed = await sealSecret(k, text('x'), NAME)
    const tampered = Uint8Array.from(sealed)
    tampered[tampered.length - 1] ^= 0xff
    await expect(openSecret(k, tampered, NAME)).rejects.toBeInstanceOf(
      SecretDecryptError,
    )
  })

  test('rejects an unknown envelope version', async () => {
    const k = await key()
    const sealed = await sealSecret(k, text('x'), NAME)
    const future = Uint8Array.from(sealed)
    future[0] = 99
    await expect(openSecret(k, future, NAME)).rejects.toBeInstanceOf(
      SecretDecryptError,
    )
  })

  test('rejects a truncated envelope', async () => {
    const k = await key()
    await expect(openSecret(k, new Uint8Array(5), NAME)).rejects.toBeInstanceOf(
      SecretDecryptError,
    )
  })
})
