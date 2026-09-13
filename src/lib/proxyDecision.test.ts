import { describe, expect, test } from 'vitest'
import {
  decideWithoutSession,
  decideWithSession,
  type ProxyRequest,
  type ProxySession,
} from './proxyDecision'
import { SESSION_RENEW_AFTER_MS, SESSION_TTL_MS } from './sessionToken'

const NOW = new Date('2026-09-14T00:00:00Z')

function request(
  pathname: string,
  options: { method?: string; host?: string; isProduction?: boolean } = {},
): ProxyRequest {
  const host = options.host ?? 'qr.tommie.jp'
  return {
    host,
    url: new URL(`https://${host}${pathname}`),
    method: options.method ?? 'GET',
    isProduction: options.isProduction ?? false,
  }
}

function session(remainingMs: number): ProxySession {
  return { token: 'session-token', expiresAt: new Date(NOW.getTime() + remainingMs) }
}

describe('decideWithoutSession', () => {
  test.each([
    ['非本番の 127.0.0.1', request('/a?b=1', { host: '127.0.0.1:3000' }), 'https://localhost:3000/a?b=1'],
    ['非本番の [::1] への POST', request('/item/1', { host: '[::1]:3000', method: 'POST' }), 'https://localhost:3000/item/1'],
  ])('%s は localhost へ送り直す', (_label, input, location) => {
    expect(decideWithoutSession(input)).toEqual({ kind: 'loopback-redirect', location })
  })

  test('本番ではループバックでも送り直さない', () => {
    const input = request('/login', { host: '127.0.0.1:3000', isProduction: true })

    expect(decideWithoutSession(input)).toEqual({ kind: 'pass' })
  })

  test.each([
    ['/login', 'GET', { kind: 'pass' }],
    ['/login', 'POST', { kind: 'pass' }],
    ['/docs/search', 'GET', { kind: 'pass' }],
    ['/login-required', 'GET', { kind: 'pass-noindex' }],
    ['/offline', 'GET', { kind: 'pass-noindex' }],
  ])('公開パス %s (%s) は %o', (pathname, method, expected) => {
    expect(decideWithoutSession(request(pathname, { method }))).toEqual(expected)
  })

  test.each([
    ['/item/4518', 'GET'],
    ['/print/4518', 'HEAD'],
    ['/api/images/0f8fad5b-d9cb-469f-a165-70867728950e.png', 'GET'],
  ])('自前で判定する口 %s の %s は通す', (pathname, method) => {
    expect(decideWithoutSession(request(pathname, { method }))).toEqual({ kind: 'pass' })
  })

  test.each([
    ['自前で判定する口への POST', '/item/4518', 'POST'],
    ['自前で判定する口の奥のパス', '/item/4518/edit', 'GET'],
    ['ログインが要る画面', '/settings', 'GET'],
    ['ログインが要る API', '/api/items', 'GET'],
  ])('%s はセッションを見るまで決めない', (_label, pathname, method) => {
    expect(decideWithoutSession(request(pathname, { method }))).toBeNull()
  })
})

describe('decideWithSession', () => {
  test('延長の頃合いでなければ通すだけ', () => {
    const fresh = session(SESSION_TTL_MS)

    expect(decideWithSession(request('/settings'), fresh, NOW)).toEqual({ kind: 'pass' })
  })

  test('延長の頃合いなら延長つきで通す', () => {
    const renewable = session(SESSION_TTL_MS - SESSION_RENEW_AFTER_MS - 1)

    expect(decideWithSession(request('/api/items', { method: 'POST' }), renewable, NOW)).toEqual({
      kind: 'pass-with-renewal',
      token: 'session-token',
    })
  })

  test.each([
    ['/settings', 'GET', true],
    ['/trash', 'HEAD', true],
    ['/item/4518/edit', 'GET', true],
    // サイトの根だけは noindex を付けない (SNS カードを壊さない。docs/89 §6)
    ['/', 'GET', false],
  ])('未ログインの画面 %s (%s) は案内へ rewrite (noindex=%s)', (pathname, method, noindex) => {
    expect(decideWithSession(request(pathname, { method }), null, NOW)).toEqual({
      kind: 'rewrite-login-required',
      noindex,
    })
  })

  test.each([
    ['/api/items', 'GET'],
    ['/api/items', 'POST'],
    ['/item/4518', 'POST'],
    ['/', 'POST'],
  ])('未ログインの %s (%s) は 401', (pathname, method) => {
    expect(decideWithSession(request(pathname, { method }), null, NOW)).toEqual({
      kind: 'unauthorized',
    })
  })
})
