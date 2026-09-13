import { describe, expect, test } from 'vitest'
import { apiDemoDisabled, apiFail, apiOk, WITHOUT_CACHE_CONTROL } from './respond'

// 封筒の書き手 (docs/93-リファクタリング計画.md §3-3)。
// 本文はキーの順まで含めて文字列で比べる — 読み手 (api/envelope.ts や
// 既存の画面) は形に依存しているので、並びが変わったら気づきたい

describe('apiOk', () => {
  test('成功の封筒を no-store で返す', async () => {
    // Act
    const res = apiOk({ id: 'cred-1' })

    // Assert
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('{"success":true,"data":{"id":"cred-1"},"error":null}')
  })

  test('状態コードを指定できる', () => {
    expect(apiOk({ id: 'cred-1' }, 201).status).toBe(201)
  })

  test('data: null もそのまま出す (送りっぱなしの口)', async () => {
    expect(await apiOk(null).text()).toBe('{"success":true,"data":null,"error":null}')
  })

  test('WITHOUT_CACHE_CONTROL なら Cache-Control を付けない', () => {
    const res = apiOk({ url: '/api/images/a.png' }, 200, WITHOUT_CACHE_CONTROL)

    expect(res.headers.get('cache-control')).toBeNull()
  })
})

describe('apiFail', () => {
  test('失敗の封筒を no-store で返す', async () => {
    const res = apiFail('ログインが必要です', 401)

    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('{"success":false,"data":null,"error":"ログインが必要です"}')
  })

  test('Cache-Control を別の値にできる (サムネの代替 404)', () => {
    const res = apiFail('サムネイルがありません', 404, { cacheControl: 'private, max-age=60' })

    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
  })

  test('WITHOUT_CACHE_CONTROL なら Cache-Control を付けない', () => {
    const res = apiFail('ISBN ではありません', 400, WITHOUT_CACHE_CONTROL)

    expect(res.headers.get('cache-control')).toBeNull()
  })
})

describe('apiDemoDisabled', () => {
  test('demoDisabled 付きの失敗を 200 で返す (Cache-Control なし)', async () => {
    const res = apiDemoDisabled('デモ版では JAN 情報を取得できません')

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBeNull()
    expect(await res.text()).toBe(
      '{"success":false,"data":null,"error":"デモ版では JAN 情報を取得できません","demoDisabled":true}',
    )
  })
})
