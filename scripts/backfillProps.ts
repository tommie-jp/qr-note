// 既存の全ノートの memo からプロパティを再抽出し items.props を埋め直す。
// props は memo 由来の派生キャッシュのため、いつでも再実行して整合を回復できる。
// 冪等: 何度実行しても結果は同じ (extractProps は純関数)。
//
// 使い方: npx tsx --conditions=react-server scripts/backfillProps.ts
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { extractProps, parseStoredProps, type PropEntry } from '@/lib/props'

async function main(): Promise<void> {
  const items = await prisma.item.findMany({ select: { itemNo: true, memo: true, props: true } })
  console.log(`対象: ${items.length} 件`)

  let updated = 0
  for (const item of items) {
    const props = extractProps(item.memo)
    // 内容が変わらないものは書き込まない。
    if (sameProps(parseStoredProps(item.props), props)) {
      continue
    }
    // props は memo 由来の派生値。バックフィルは「編集」ではないので、
    // @updatedAt を発火させない生 SQL で更新し、並び順 (更新日順) を保つ。
    await prisma.$executeRaw`UPDATE items SET props = ${JSON.stringify(props)}::jsonb WHERE item_no = ${item.itemNo}`
    updated += 1
    console.log(`  ${item.itemNo}: ${props.map((p) => `${p.label}=${p.value}`).join(' ')}`)
  }

  console.log(`更新: ${updated} 件 / 変更なし: ${items.length - updated} 件`)
}

// 順序も含めて一致するか (extractProps は初出順で安定するため順序比較でよい)。
function sameProps(a: PropEntry[], b: PropEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.key === b[i].key && p.label === b[i].label && p.value === b[i].value)
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
