import { describe, expect, test } from 'vitest'
import { isPageRequest, isReadRequest } from './requestKind'

describe('isReadRequest', () => {
  test.each([
    ['GET', true],
    ['HEAD', true],
    ['POST', false],
    ['PUT', false],
    ['DELETE', false],
    ['OPTIONS', false],
  ])('%s は %s', (method, expected) => {
    expect(isReadRequest(method)).toBe(expected)
  })
})

describe('isPageRequest', () => {
  test.each([
    ['GET', '/settings', true],
    ['HEAD', '/', true],
    // Server Action は画面の URL へ POST される。案内に化けさせない
    ['POST', '/item/4518', false],
    // 画像配信は読み取りだが画面ではない
    ['GET', '/api/images/a.png', false],
    ['POST', '/api/items', false],
    // /api で始まるだけの画面パスは画面として扱う (区切りの / まで見る)
    ['GET', '/apiary', true],
  ])('%s %s は %s', (method, pathname, expected) => {
    expect(isPageRequest(method, pathname)).toBe(expected)
  })
})
