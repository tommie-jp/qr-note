import { describe, expect, test } from 'vitest'
import {
  chunkSecretFetch,
  matchSecretTexts,
  normalizeSecretText,
  planSecretSync,
  SECRET_BATCH_TARGET_BYTES,
  SECRET_BATCH_MAX_NAMES,
  secretQueryTerms,
  secretSearchHits,
  type CachedSecretText,
  type SecretTextEntry,
} from './search'

const A = '0421547b-ee29-4613-a6d4-da0f41f94054'
const B = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const C = '9c5b94b1-35ad-49bb-b118-8e8fc24abf80'

function entry(name: string, bytes = 100, hash = `hash-${name}`): SecretTextEntry {
  return { name, hash, bytes, refs: [{ itemId: `item-${name}`, title: `題名 ${name}`, label: 'ラベル' }] }
}

describe('secretQueryTerms', () => {
  test('素の語だけを正規化して取り出す (タグ・is: は捨てる)', () => {
    expect(secretQueryTerms('ＡＢＣ銀行 #金融 is:todo 1234')).toEqual(['abc銀行', '1234'])
  })

  test('NOT の下の語は照合に使わない', () => {
    expect(secretQueryTerms('口座 !解約')).toEqual(['口座'])
  })

  test('OR の両辺は区別せず集める・同じ語は 1 つ', () => {
    expect(secretQueryTerms('wifi | WIFI | パスワード')).toEqual(['wifi', 'パスワード'])
  })

  test('空・演算子だけなら語なし', () => {
    expect(secretQueryTerms('')).toEqual([])
    expect(secretQueryTerms('   ')).toEqual([])
    expect(secretQueryTerms('#タグ')).toEqual([])
  })
})

describe('matchSecretTexts', () => {
  const haystacks = new Map([
    [A, normalizeSecretText('ＡＢＣ銀行 口座 1234567')],
    [B, normalizeSecretText('Wi-Fi のパスワード: Hunter2')],
    [C, normalizeSecretText('口座だけ')],
  ])

  test('全角半角・大文字小文字を同一視して部分一致', () => {
    expect(matchSecretTexts(haystacks, secretQueryTerms('abc'))).toEqual([A])
    expect(matchSecretTexts(haystacks, secretQueryTerms('HUNTER2'))).toEqual([B])
  })

  test('語は 1 つの断片の中で AND', () => {
    expect(matchSecretTexts(haystacks, secretQueryTerms('口座 1234'))).toEqual([A])
    expect(matchSecretTexts(haystacks, secretQueryTerms('口座'))).toEqual([A, C])
    // 語 A は断片 A に、語 B は断片 B に — 断片をまたぐ AND は一致にしない
    expect(matchSecretTexts(haystacks, secretQueryTerms('1234 hunter2'))).toEqual([])
  })

  test('語が無ければ何も当てない', () => {
    expect(matchSecretTexts(haystacks, [])).toEqual([])
  })
})

describe('secretSearchHits', () => {
  test('一致した断片を参照元ノートの行へ開く (一覧の順)', () => {
    const shared: SecretTextEntry = {
      name: B,
      hash: 'h',
      bytes: 1,
      refs: [
        { itemId: 'n1', title: 'ノート 1', label: '銀行' },
        { itemId: 'n2', title: 'ノート 2', label: '控え' },
      ],
    }

    expect(secretSearchHits([entry(A), shared, entry(C)], [C, B])).toEqual([
      { name: B, itemId: 'n1', title: 'ノート 1', label: '銀行' },
      { name: B, itemId: 'n2', title: 'ノート 2', label: '控え' },
      { name: C, itemId: `item-${C}`, title: `題名 ${C}`, label: 'ラベル' },
    ])
  })
})

describe('planSecretSync', () => {
  const cachedOf = (pairs: [string, string][]): Map<string, CachedSecretText> =>
    new Map(pairs.map(([name, hash]) => [name, { hash, data: new Uint8Array([1]) }]))

  test('控えに無い・ハッシュが変わった断片だけを取りに行く', () => {
    const cached = cachedOf([
      [A, `hash-${A}`],
      [B, 'old-hash'],
    ])

    expect(planSecretSync([entry(A), entry(B), entry(C)], cached)).toEqual({
      keep: [A],
      fetch: [B, C],
      skipped: 0,
    })
  })

  test('一覧から消えた控えは keep にも fetch にも入らない', () => {
    const cached = cachedOf([[C, `hash-${C}`]])

    expect(planSecretSync([entry(A)], cached)).toEqual({ keep: [], fetch: [A], skipped: 0 })
  })

  test('合計の上限を超えた断片は対象外にして数える', () => {
    const plan = planSecretSync([entry(A, 60), entry(B, 60), entry(C, 30)], new Map(), 100)

    expect(plan).toEqual({ keep: [], fetch: [A, C], skipped: 1 })
  })
})

describe('chunkSecretFetch', () => {
  test('件数の上限で束を切る', () => {
    const names = Array.from({ length: SECRET_BATCH_MAX_NAMES + 1 }, (_, i) => `n${i}`)

    const chunks = chunkSecretFetch(names, () => 1)

    expect(chunks.map((chunk) => chunk.length)).toEqual([SECRET_BATCH_MAX_NAMES, 1])
  })

  test('合計バイトの上限で束を切り、1 件で超える断片は単独にする', () => {
    const sizes = new Map([
      [A, SECRET_BATCH_TARGET_BYTES - 10],
      [B, 20],
      [C, SECRET_BATCH_TARGET_BYTES + 1],
    ])

    expect(chunkSecretFetch([A, B, C, A], (name) => sizes.get(name) ?? 0)).toEqual([
      [A],
      [B],
      [C],
      [A],
    ])
  })

  test('空なら束なし', () => {
    expect(chunkSecretFetch([], () => 1)).toEqual([])
  })
})
