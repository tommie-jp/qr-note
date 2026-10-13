// 既存ノートの ```circuit フェンスの旧い番地 (`a1` `a1f5`) を `x,y` に書き直す
// (docs/102)。circuit-fence 0.35.0 から旧い綴りは読まずに断るので、**版を配る直後に
// 1 回**流す。書き直しの中身は上流の migrateCircuitFences。
//
// 冪等: 書き直したあとは `changed` が 0 になるので、何度流しても同じ。
// 読めなかった語が残るノートは書かずに一覧へ出す (半端な図にしない)。
//
// これは**ノートの本文 (正本) を書き換える**。派生列 (title / tags / props / タスク数) は
// 本文を書く他の経路と同じ derivedFromMemo で作り直す。updated_at は普通の編集と同じく
// 進める — 開いたままの編集画面に競合として見せるため。
//
// 環境変数 DRY_RUN=1 で書かずに、書き直す対象と数だけを出す。
//
// 使い方: npx tsx --conditions=react-server scripts/backfillCircuitAddresses.ts
//   (本番/デモへは ./doBackfill.sh circuit-addresses 経由。DRY_RUN=1 を前置できる)
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { derivedFromMemo } from '@/lib/items/write'
import { planAddressMigration } from '@/lib/circuit/migrateAddresses'

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1'
  // **LIKE は使わない** — PGroonga が LIKE を全文一致に乗っ取るので、部分一致は
  // position() で見る (rewriteImageReference と同じ流儀)。ゴミ箱の行も含める。
  const rows = await prisma.$queryRaw<{ item_no: string; memo: string }[]>`
    SELECT item_no, memo FROM items WHERE position('circuit' IN memo) > 0
    ORDER BY item_no
  `
  console.log(`${dryRun ? '[DRY_RUN] ' : ''}対象の候補: ${rows.length} 件`)

  let rewritten = 0
  let unchanged = 0
  const manual: string[] = []
  for (const row of rows) {
    const plan = planAddressMigration(row.memo)
    if (plan.kind === 'unchanged') {
      unchanged += 1
      continue
    }
    if (plan.kind === 'manual') {
      manual.push(`${row.item_no}: ${plan.skipped.join(' ')}`)
      continue
    }
    console.log(`  ${row.item_no}: ${plan.changed} か所${dryRun ? ' (書かない)' : ''}`)
    if (!dryRun) {
      await prisma.item.update({
        where: { itemNo: row.item_no },
        data: { memo: plan.memo, ...derivedFromMemo(plan.memo) },
      })
    }
    rewritten += 1
  }

  console.log(`書き直し: ${rewritten} 件 / 変更なし: ${unchanged} 件 / 人の目が要る: ${manual.length} 件`)
  for (const line of manual) {
    console.log(`  要確認 ${line}`)
  }
  if (manual.length > 0) {
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
