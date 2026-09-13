// 既存の全ノートの memo からタグを再抽出し items.tags を埋め直す。
// tags は memo 由来の派生キャッシュのため、いつでも再実行して整合を回復できる。
// 冪等: 何度実行しても結果は同じ (extractTags は純関数)。
//
// 使い方: npx tsx --conditions=react-server scripts/backfillTags.ts
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { extractTags } from '@/lib/tags'

async function main(): Promise<void> {
  const items = await prisma.item.findMany({ select: { itemNo: true, memo: true, tags: true } })
  console.log(`対象: ${items.length} 件`)

  let updated = 0
  for (const item of items) {
    const tags = extractTags(item.memo)
    // 内容が変わらないものは書き込まない。
    if (sameTags(item.tags, tags)) {
      continue
    }
    // tags は memo 由来の派生値。バックフィルは「編集」ではないので、
    // @updatedAt を発火させない生 SQL で更新し、並び順 (更新日順) を保つ。
    await prisma.$executeRaw`UPDATE items SET tags = ${tags}::text[] WHERE item_no = ${item.itemNo}`
    updated += 1
    console.log(`  ${item.itemNo}: [${tags.join(', ')}]`)
  }

  console.log(`更新: ${updated} 件 / 変更なし: ${items.length - updated} 件`)
}

// 順序も含めて一致するか (extractTags は初出順で安定するため順序比較でよい)。
function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
