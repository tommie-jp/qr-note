import { describe, expect, test } from 'vitest'
import { buildSecretTextIndex } from './textRefs'

const A = '0421547b-ee29-4613-a6d4-da0f41f94054'
const B = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const ORPHAN = '9c5b94b1-35ad-49bb-b118-8e8fc24abf80'

const row = (name: string) => ({ name, hash: `h-${name}`, bytes: 10 })

describe('buildSecretTextIndex', () => {
  test('本文の記法から参照元ノートとラベルを引く', () => {
    const items = [
      { itemId: 'n1', title: '銀行まとめ', memo: `口座: ![ＡＢＣ銀行](/api/secrets/${A})` },
      { itemId: 'n2', title: '', memo: `![Wi-Fi](/api/secrets/${B})\n![控え](/api/secrets/${A})` },
    ]

    expect(buildSecretTextIndex([row(A), row(B)], items)).toEqual([
      {
        ...row(A),
        refs: [
          { itemId: 'n1', title: '銀行まとめ', label: 'ＡＢＣ銀行' },
          { itemId: 'n2', title: '', label: '控え' },
        ],
      },
      { ...row(B), refs: [{ itemId: 'n2', title: '', label: 'Wi-Fi' }] },
    ])
  })

  test('どのノートからも参照されていない断片は落とす', () => {
    const items = [{ itemId: 'n1', title: 't', memo: `![x](/api/secrets/${A})` }]

    expect(buildSecretTextIndex([row(A), row(ORPHAN)], items).map((e) => e.name)).toEqual([A])
  })

  test('コードの中の記法は参照に数えない', () => {
    const items = [
      { itemId: 'n1', title: 't', memo: `\`![x](/api/secrets/${A})\`\n\`\`\`\n![y](/api/secrets/${B})\n\`\`\`` },
    ]

    expect(buildSecretTextIndex([row(A), row(B)], items)).toEqual([])
  })

  test('テキスト断片でない名前 (行に無い) は一覧に出ない', () => {
    const items = [{ itemId: 'n1', title: 't', memo: `![写真](/api/secrets/${B})` }]

    expect(buildSecretTextIndex([row(A)], items)).toEqual([])
  })
})
