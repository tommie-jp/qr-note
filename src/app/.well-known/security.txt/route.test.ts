import { expect, test } from 'vitest'
import { dynamic, GET } from './route'

// ビルド時に 1 回だけ作って書き出す。リクエストのたびに作ると Expires が
// 永遠に 1 年先へ逃げ続け、「放置されたら切れる」が働かない
test('ビルド時に静的に書き出す', () => {
  expect(dynamic).toBe('force-static')
})

test('text/plain で連絡先と期限を返す', async () => {
  const res = GET()
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  const text = await res.text()
  expect(text).toContain('Contact: ')
  expect(text).toContain('Expires: ')
})
