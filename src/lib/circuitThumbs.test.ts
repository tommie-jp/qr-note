import { beforeEach, describe, expect, test, vi } from 'vitest'
import { circuitHash } from './circuitikz'

// DB は差し替えて、足切り・突き合わせ・予算の分岐だけを見る。
// 描画 (renderCircuit) はこのモジュールから決して呼ばれない — 一覧は
// 「引くだけ」の約束 (docs/68-一覧回路図サムネ計画.md §2)
const findMany = vi.fn()

vi.mock('./db', () => ({
  prisma: { circuitSvg: { findMany: (...a: unknown[]) => findMany(...a) } },
}))

const { CIRCUIT_THUMB_BUDGET, MAX_CIRCUIT_THUMB_BYTES, loadCircuitThumbs } =
  await import('./circuitThumbs')

const SVG_A = '<svg><path d="M0 0"/></svg>'
const SVG_B = '<svg><path d="M1 1"/></svg>'
const IMAGE = '0421547b-ee29-4613-a6d4-da0f41f94054.jpg'

const fence = (source: string) => `\`\`\`circuitikz\n${source}\n\`\`\``

function makeItem(
  itemNo: string,
  memo: string,
  mode: 'memo' | 'url' = 'memo',
) {
  return { itemNo, memo, mode }
}

// 検査 (assertSafeCircuitSvg) を通り、かつ好きな大きさに膨らませられる SVG。
// タグ以外の文字は検査対象にならないので、中身のテキストで嵩を稼ぐ
const paddedSvg = (bytes: number) => {
  const shell = '<svg></svg>'
  return `<svg>${'a'.repeat(Math.max(0, bytes - shell.length))}</svg>`
}

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([])
})

describe('足切り (DB を引くまでもない物)', () => {
  test('回路図フェンスの無いノートだけならクエリ 0 回で空を返す', async () => {
    const map = await loadCircuitThumbs(
      [makeItem('1', '文章だけのノート')],
      'first',
    )

    expect(map).toEqual({})
    expect(findMany).not.toHaveBeenCalled()
  })

  test('URL モードのノートは対象外', async () => {
    // URL モードの memo は空のはずだが、足切りは mode を見て確実に外す
    const map = await loadCircuitThumbs(
      [makeItem('1', fence('A'), 'url')],
      'all',
    )

    expect(map).toEqual({})
    expect(findMany).not.toHaveBeenCalled()
  })

  test('first では画像サムネを持つノートを引かない (画像が優先)', async () => {
    const withImage = makeItem(
      '1',
      `写真\n![](/api/images/${IMAGE})\n${fence('A')}`,
    )

    const map = await loadCircuitThumbs([withImage], 'first')

    expect(map).toEqual({})
    expect(findMany).not.toHaveBeenCalled()
  })

  test('all では画像サムネを持つノートの回路図も引く (タイルは併記)', async () => {
    findMany.mockResolvedValue([{ hash: circuitHash('A'), svg: SVG_A }])
    const withImage = makeItem(
      '1',
      `写真\n![](/api/images/${IMAGE})\n${fence('A')}`,
    )

    const map = await loadCircuitThumbs([withImage], 'all')

    expect(map).toEqual({ '1': [SVG_A] })
  })
})

describe('キャッシュとの突き合わせ', () => {
  test('描画済みの SVG を出現順に返す', async () => {
    findMany.mockResolvedValue([
      // DB の返却順はキャッシュ任せ。並びは本文の出現順に揃え直すこと
      { hash: circuitHash('B'), svg: SVG_B },
      { hash: circuitHash('A'), svg: SVG_A },
    ])

    const map = await loadCircuitThumbs(
      [makeItem('1', `${fence('A')}\n\n${fence('B')}`)],
      'all',
    )

    expect(map).toEqual({ '1': [SVG_A, SVG_B] })
  })

  test('未描画の図は黙って飛ばす (エラーにしない)', async () => {
    findMany.mockResolvedValue([{ hash: circuitHash('B'), svg: SVG_B }])

    const map = await loadCircuitThumbs(
      [makeItem('1', `${fence('A')}\n\n${fence('B')}`)],
      'all',
    )

    expect(map).toEqual({ '1': [SVG_B] })
  })

  test('first は最初に描画済みの 1 枚だけを返す', async () => {
    // 1 枚目 (A) が未描画でも、2 枚目 (B) が描けていればそれを顔にする
    findMany.mockResolvedValue([{ hash: circuitHash('B'), svg: SVG_B }])

    const map = await loadCircuitThumbs(
      [makeItem('1', `${fence('A')}\n\n${fence('B')}`)],
      'first',
    )

    expect(map).toEqual({ '1': [SVG_B] })
  })

  test('全部未描画のノートはキーごと出ない', async () => {
    const map = await loadCircuitThumbs([makeItem('1', fence('A'))], 'all')

    expect(map).toEqual({})
  })

  test('同じ図を持つ複数ノートに同じ SVG が付く (hash は重複なしで引く)', async () => {
    findMany.mockResolvedValue([{ hash: circuitHash('A'), svg: SVG_A }])

    const map = await loadCircuitThumbs(
      [makeItem('1', fence('A')), makeItem('2', fence('A'))],
      'all',
    )

    expect(map).toEqual({ '1': [SVG_A], '2': [SVG_A] })
    const arg = findMany.mock.calls[0][0] as {
      where: { hash: { in: string[] } }
    }
    expect(arg.where.hash.in).toEqual([circuitHash('A')])
  })

  test('9 個目以降のフェンスは引きにも行かない (描画側の上限と同じ 8 個)', async () => {
    const memo = Array.from({ length: 10 }, (_, i) => fence(`C${i}`)).join('\n\n')

    await loadCircuitThumbs([makeItem('1', memo)], 'all')

    const arg = findMany.mock.calls[0][0] as {
      where: { hash: { in: string[] } }
    }
    expect(arg.where.hash.in).toHaveLength(8)
    expect(arg.where.hash.in).not.toContain(circuitHash('C8'))
  })
})

describe('静かなフォールバック (一覧を壊さない)', () => {
  test('DB が落ちていても空を返す (一覧自体は出る)', async () => {
    findMany.mockRejectedValue(new Error('db down'))

    const map = await loadCircuitThumbs([makeItem('1', fence('A'))], 'all')

    expect(map).toEqual({})
  })

  test('検査に通らない SVG は飛ばし、他の図は出す', async () => {
    findMany.mockResolvedValue([
      { hash: circuitHash('A'), svg: '<svg><script>alert(1)</script></svg>' },
      { hash: circuitHash('B'), svg: SVG_B },
    ])

    const map = await loadCircuitThumbs(
      [makeItem('1', `${fence('A')}\n\n${fence('B')}`)],
      'all',
    )

    expect(map).toEqual({ '1': [SVG_B] })
  })
})

describe('ペイロード予算', () => {
  test('1 枚の上限を超える SVG は飛ばす', async () => {
    findMany.mockResolvedValue([
      { hash: circuitHash('A'), svg: paddedSvg(MAX_CIRCUIT_THUMB_BYTES + 1) },
      { hash: circuitHash('B'), svg: SVG_B },
    ])

    const map = await loadCircuitThumbs(
      [makeItem('1', `${fence('A')}\n\n${fence('B')}`)],
      'all',
    )

    expect(map).toEqual({ '1': [SVG_B] })
  })

  test('合計予算を超えたら残りを黙って落とす (一覧の先頭から詰める)', async () => {
    // 上限いっぱいの SVG を、合計予算を必ず超える件数だけ並べる
    const big = paddedSvg(MAX_CIRCUIT_THUMB_BYTES)
    const fit = Math.floor(CIRCUIT_THUMB_BUDGET / MAX_CIRCUIT_THUMB_BYTES)
    const count = fit + 3
    const items = Array.from({ length: count }, (_, i) =>
      makeItem(`${i + 1}`, fence(`C${i}`)),
    )
    findMany.mockResolvedValue(
      Array.from({ length: count }, (_, i) => ({
        hash: circuitHash(`C${i}`),
        svg: big,
      })),
    )

    const map = await loadCircuitThumbs(items, 'all')

    expect(map[`${fit}`]).toEqual([big])
    expect(map[`${fit + 1}`]).toBeUndefined()
    expect(map[`${count}`]).toBeUndefined()
  })

  test('予算切れの項目でも、入りきった分の図は捨てずに出す', async () => {
    // 上限いっぱいの図で予算の残りを 1 枚ぶんまで減らし、最後に
    // 2 図持ち (小 + 上限) の項目を置く。小は入るが上限の方は入らない
    const big = paddedSvg(MAX_CIRCUIT_THUMB_BYTES)
    const small = paddedSvg(1024)
    const fillers = Math.floor(CIRCUIT_THUMB_BUDGET / MAX_CIRCUIT_THUMB_BYTES) - 1
    const items = [
      ...Array.from({ length: fillers }, (_, i) =>
        makeItem(`${i + 1}`, fence(`C${i}`)),
      ),
      makeItem('last', `${fence('B')}\n\n${fence('C')}`),
    ]
    findMany.mockResolvedValue([
      ...Array.from({ length: fillers }, (_, i) => ({
        hash: circuitHash(`C${i}`),
        svg: big,
      })),
      { hash: circuitHash('B'), svg: small },
      { hash: circuitHash('C'), svg: big },
    ])

    const map = await loadCircuitThumbs(items, 'all')

    // C (上限いっぱい) は残り予算に入らないが、既に入った B まで消してはいけない
    expect(map['last']).toEqual([small])
  })
})
