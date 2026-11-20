// テキスト断片と、それを参照しているノートを突き合わせる
// (docs/130-シークレット内検索計画.md §5-1)。
//
// `secrets` の行は「どのノートの断片か」を持たない。対応は本文の
// `![ラベル](/api/secrets/<UUID>)` にしか無いので、断片を持つノートの本文から
// 引き直す。**DB に触らない純関数**にしてある (引くのは secret/textIndex.ts)。

import type { SecretTextEntry, SecretTextRef } from './search'
import { allSecretNotations } from './secrets'

// 突き合わせの材料: テキスト断片の行
export interface SecretTextRow {
  name: string
  hash: string
  bytes: number
}

// 突き合わせの材料: 断片を参照していそうなノート
export interface SecretRefItem {
  itemId: string
  title: string
  memo: string
}

// 参照元のあるテキスト断片だけを、行の順のまま返す。
// **どのノートからも参照されていない断片 (GC 待ち) は落とす** — 端末へ運んでも
// 一致を見せる先が無い (docs/130 §4)。
export function buildSecretTextIndex(
  rows: readonly SecretTextRow[],
  items: readonly SecretRefItem[],
): SecretTextEntry[] {
  const refsByName = new Map<string, SecretTextRef[]>()
  for (const item of items) {
    for (const { name, label } of allSecretNotations(item.memo)) {
      const ref = { itemId: item.itemId, title: item.title, label }
      const refs = refsByName.get(name)
      if (refs === undefined) {
        refsByName.set(name, [ref])
      } else {
        refs.push(ref)
      }
    }
  }
  return rows.flatMap((row) => {
    const refs = refsByName.get(row.name)
    return refs === undefined ? [] : [{ ...row, refs }]
  })
}
