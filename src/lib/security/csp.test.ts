import { describe, expect, test } from 'vitest'
import { contentSecurityPolicy, createNonce, CSP_REPORT_PATH } from './csp'

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy({ nonce: 'abc123', isDev: false })

  test('allows scripts only from self and the per-request nonce', () => {
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'wasm-unsafe-eval'")
    expect(policy).not.toContain("'unsafe-eval'")
    // 'strict-dynamic' を付けると「図を編集」の srcdoc iframe が死ぬ (csp.ts の注)
    expect(policy).not.toContain('strict-dynamic')
  })

  test('adds unsafe-eval only for next dev', () => {
    expect(contentSecurityPolicy({ nonce: 'n', isDev: true })).toContain("'unsafe-eval'")
  })

  test('closes the directives that do not need to be open', () => {
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
  })

  test('keeps what the app needs: wasm, workers, external images, model host', () => {
    expect(policy).toContain("worker-src 'self' blob:")
    expect(policy).toContain("img-src 'self' data: blob: https:")
    expect(policy).toContain('https://huggingface.co')
    expect(policy).toContain("frame-src 'self'")
  })

  test('reports violations to the report route', () => {
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`)
    expect(policy).toContain('report-to csp')
  })
})

describe('createNonce', () => {
  test('is base64 of 16 random bytes and differs every time', () => {
    const a = createNonce()
    const b = createNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(a).not.toBe(b)
  })
})
