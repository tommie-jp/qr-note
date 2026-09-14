import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isPasskeyEnabled, webauthnConfig } from './webauthnConfig'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

function setEnv(rpId: string | undefined, origin: string | undefined): void {
  if (rpId === undefined) {
    delete process.env.WEBAUTHN_RP_ID
  } else {
    process.env.WEBAUTHN_RP_ID = rpId
  }
  if (origin === undefined) {
    delete process.env.WEBAUTHN_ORIGIN
  } else {
    process.env.WEBAUTHN_ORIGIN = origin
  }
}

describe('webauthnConfig', () => {
  test('reads the production settings', () => {
    setEnv('qr.tommie.jp', 'https://qr.tommie.jp')

    expect(webauthnConfig()).toEqual({
      rpId: 'qr.tommie.jp',
      origin: 'https://qr.tommie.jp',
      rpName: 'QR Note',
    })
  })

  test('accepts http://localhost for local development', () => {
    // localhost だけは WebAuthn の特例で HTTP でも動く
    setEnv('localhost', 'http://localhost:3000')

    expect(webauthnConfig()?.origin).toBe('http://localhost:3000')
  })

  test('drops a trailing slash so the origin compares equal', () => {
    setEnv('qr.tommie.jp', 'https://qr.tommie.jp/')

    expect(webauthnConfig()?.origin).toBe('https://qr.tommie.jp')
  })

  test('returns null when the rp id is missing', () => {
    setEnv(undefined, 'https://qr.tommie.jp')

    expect(webauthnConfig()).toBe(null)
  })

  test('returns null when the origin is missing', () => {
    setEnv('qr.tommie.jp', undefined)

    expect(webauthnConfig()).toBe(null)
  })

  test('returns null when the values are set but empty', () => {
    // .env に `WEBAUTHN_RP_ID=` と書くと undefined ではなく空文字が来る
    setEnv('', '')

    expect(webauthnConfig()).toBe(null)
  })

  test('returns null when the origin is not a URL', () => {
    setEnv('qr.tommie.jp', 'qr.tommie.jp')

    expect(webauthnConfig()).toBe(null)
  })

  test('returns null when the origin host does not match the rp id', () => {
    // 一致しないと登録も検証も必ず失敗する。起動時ではなく使用時に
    // 気づける形で落とす
    setEnv('qr.tommie.jp', 'https://evil.example.com')

    expect(webauthnConfig()).toBe(null)
  })

  test('allows the origin to be a subdomain of the rp id', () => {
    setEnv('tommie.jp', 'https://qr.tommie.jp')

    expect(webauthnConfig()?.rpId).toBe('tommie.jp')
  })

  test('rejects a lookalike host that merely ends with the rp id', () => {
    setEnv('tommie.jp', 'https://nottommie.jp')

    expect(webauthnConfig()).toBe(null)
  })

  test('explains itself in the log rather than failing silently', () => {
    setEnv('qr.tommie.jp', undefined)

    webauthnConfig()

    expect(console.error).toHaveBeenCalled()
  })
})

describe('isPasskeyEnabled', () => {
  test('is true once both settings are present and consistent', () => {
    setEnv('qr.tommie.jp', 'https://qr.tommie.jp')

    expect(isPasskeyEnabled()).toBe(true)
  })

  test('is false when the settings are missing (Basic auth still works)', () => {
    setEnv(undefined, undefined)

    expect(isPasskeyEnabled()).toBe(false)
  })
})
