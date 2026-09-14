import { describe, expect, test } from 'vitest'
import { loopbackRedirectUrl } from './loopbackRedirect'

// Next.js は nextUrl のホストを localhost に正規化してしまうため、判定は
// Host ヘッダで行う。テストもその形 (ヘッダと URL が食い違う) を再現する
function nextUrl(path = '/'): URL {
  return new URL(`http://localhost:3000${path}`)
}

describe('loopbackRedirectUrl (非本番)', () => {
  test('127.0.0.1 を同じポートの localhost へ送る', () => {
    expect(loopbackRedirectUrl('127.0.0.1:3000', nextUrl(), false)).toBe(
      'http://localhost:3000/',
    )
  })

  test('パスとクエリを保つ', () => {
    expect(
      loopbackRedirectUrl('127.0.0.1:3000', nextUrl('/item/4518?q=abc'), false),
    ).toBe('http://localhost:3000/item/4518?q=abc')
  })

  test('ポートの指定がなくても壊れない', () => {
    expect(loopbackRedirectUrl('127.0.0.1', nextUrl('/logs'), false)).toBe(
      'http://localhost/logs',
    )
  })

  test('IPv6 のループバックも送る', () => {
    expect(loopbackRedirectUrl('[::1]:3000', nextUrl(), false)).toBe(
      'http://localhost:3000/',
    )
  })

  test('Host が localhost ならそのまま (転送しない)', () => {
    expect(loopbackRedirectUrl('localhost:3000', nextUrl(), false)).toBe(null)
  })

  test('LAN の IP はそのまま — スマホ実機での確認を壊さない', () => {
    expect(loopbackRedirectUrl('10.255.255.254:3000', nextUrl(), false)).toBe(null)
    expect(loopbackRedirectUrl('192.168.1.5:3000', nextUrl(), false)).toBe(null)
  })

  test('127.0.0.1 に似た別ホストは送らない', () => {
    expect(loopbackRedirectUrl('127.0.0.11:3000', nextUrl(), false)).toBe(null)
    expect(loopbackRedirectUrl('127.0.0.1.example.com', nextUrl(), false)).toBe(null)
  })

  test('ドメイン名はそのまま', () => {
    expect(loopbackRedirectUrl('qr.tommie.jp', nextUrl(), false)).toBe(null)
  })

  test('Host ヘッダが無い / 壊れていても投げない', () => {
    expect(loopbackRedirectUrl(null, nextUrl(), false)).toBe(null)
    expect(loopbackRedirectUrl('', nextUrl(), false)).toBe(null)
    expect(loopbackRedirectUrl('こわれた ホスト', nextUrl(), false)).toBe(null)
  })

  test('転送先の scheme はリクエストに合わせる', () => {
    expect(
      loopbackRedirectUrl('127.0.0.1:3000', new URL('https://localhost:3000/x'), false),
    ).toBe('https://localhost:3000/x')
  })
})

describe('loopbackRedirectUrl (本番)', () => {
  // 本番はアプリの前に nginx が居て、自分では 0.0.0.0 しか見えていない。
  // ここで host を信じて絶対 URL を組むと、login/route.ts で踏んだのと同じ
  // 「http://0.0.0.0:3100/... へ飛ばす」を再現してしまう
  test('本番では何があっても転送しない', () => {
    expect(loopbackRedirectUrl('127.0.0.1:3000', nextUrl(), true)).toBe(null)
    expect(loopbackRedirectUrl('[::1]:3000', nextUrl(), true)).toBe(null)
  })
})
