import { expect, test } from 'vitest'

// assembleIndex は純関数だが、同じモジュールの buildImageSearchIndex が
// 読み込み時に @/lib/db を評価する (db.ts は DATABASE_URL 未設定だと throw)。
// 実 DB には触れない (PrismaClient は遅延接続) ので、到達不能なダミーを置く
// — images.test.ts と同じ流儀。
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'

const { assembleIndex } = await import('./imageSearchIndex')

const A = '0421547b-ee29-4613-a6d4-da0f41f94054.jpg'
const B = '11108562-47b2-4c00-846d-23dd7e804ff8.png'

test('本文の画像を埋め込み付きで索引に載せる', () => {
  const items = [{ itemNo: '001', memo: `抵抗 10kΩ\n![](/api/images/${A})` }]
  const embeddings = new Map([[A, 'AAAA']])

  const index = assembleIndex(items, embeddings)

  expect(index).toEqual([
    { itemNo: '001', title: '抵抗 10kΩ', imageName: A, embedding: 'AAAA' },
  ])
})

test('埋め込みが無い画像は載せない (検索対象から外す)', () => {
  const items = [{ itemNo: '001', memo: `![](/api/images/${A})\n![](/api/images/${B})` }]
  const embeddings = new Map([[A, 'AAAA']]) // B は未生成

  const index = assembleIndex(items, embeddings)

  expect(index.map((e) => e.imageName)).toEqual([A])
})

test('1 ノートに複数枚あれば同じ itemNo で複数並ぶ', () => {
  const items = [{ itemNo: '001', memo: `![](/api/images/${A})\n![](/api/images/${B})` }]
  const embeddings = new Map([
    [A, 'AAAA'],
    [B, 'BBBB'],
  ])

  const index = assembleIndex(items, embeddings)

  expect(index).toHaveLength(2)
  expect(index.every((e) => e.itemNo === '001')).toBe(true)
})

test('要約が空なら部品番号をラベルにする', () => {
  const items = [{ itemNo: '042', memo: `![](/api/images/${A})` }]
  const index = assembleIndex(items, new Map([[A, 'AAAA']]))

  expect(index[0].title).toBe('042')
})

test('画像の無いノートは索引に出ない', () => {
  const items = [{ itemNo: '001', memo: 'ただのメモ' }]
  expect(assembleIndex(items, new Map())).toEqual([])
})
