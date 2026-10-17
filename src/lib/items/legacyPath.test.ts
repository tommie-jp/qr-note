import { describe, expect, test } from 'vitest'
import { parseLegacyItemPath } from './legacyPath'

const ID = '01a14854-8d04-732d-8712-f52debf9e66a'
const OID = 'a'.repeat(40)

describe('parseLegacyItemPath', () => {
  test.each([
    ['/item/1003', { prefix: '/item/', key: '1003', suffix: '' }],
    ['/edit/1003', { prefix: '/edit/', key: '1003', suffix: '' }],
    ['/print/100x', { prefix: '/print/', key: '100x', suffix: '' }],
    ['/item/wb01-03-08', { prefix: '/item/', key: 'wb01-03-08', suffix: '' }],
    ['/item/1003/history', { prefix: '/item/', key: '1003', suffix: '/history' }],
    [`/item/1003/history/${OID}`, { prefix: '/item/', key: '1003', suffix: `/history/${OID}` }],
  ])('旧番号の URL %s を切り分ける', (pathname, expected) => {
    expect(parseLegacyItemPath(pathname)).toEqual(expected)
  })

  test.each([
    [`/item/${ID}`, 'id の URL は素通し'],
    [`/item/${ID}/history`, 'id の履歴も素通し'],
    ['/edit/1003/history', '履歴が付くのは /item だけ'],
    ['/item/1003/other', '知らない続き'],
    ['/item/1003/history/HEAD', 'oid でない続き'],
    ['/item/a.b', '旧番号の形でない'],
    ['/item/', '空'],
    ['/trash', 'ノートの URL でない'],
  ])('%s は対象外 (%s)', (pathname) => {
    expect(parseLegacyItemPath(pathname)).toBeNull()
  })
})
