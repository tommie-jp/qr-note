// circuit フェンスの旧い番地 (`a1` `a1f5`) を `x,y` に書き直す (docs/102)。
//
// circuit-fence 0.35.0 から旧い綴りは読まずに断る。**書き直しは上流の
// `migrateCircuitFences` に任せる** — 番地を書く場所の語だけを旧い読み手に通すので、
// 部品 ID (`C1`)・値・ピン (`U1.5`) を取り違えない。ここは「書いてよいか」の判断だけを持つ。
import { migrateCircuitFences } from 'circuit-fence/core'

export type AddressMigration =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewrite'; readonly memo: string; readonly changed: number }
  // 番地を書く場所にあったが旧い読み手でも読めなかった語がある。一部だけ書き直して
  // 残りを残すと半端な図になるので、書かずに人へ返す
  | { readonly kind: 'manual'; readonly skipped: readonly string[] }

export function planAddressMigration(memo: string): AddressMigration {
  const result = migrateCircuitFences(memo)
  if (result.skipped.length > 0) {
    return { kind: 'manual', skipped: result.skipped }
  }
  if (result.changed === 0 || result.text === memo) {
    return { kind: 'unchanged' }
  }
  return { kind: 'rewrite', memo: result.text, changed: result.changed }
}
