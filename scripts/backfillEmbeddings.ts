// 既存の全画像の data から埋め込みベクトルを作り images.embedding を埋める
// (docs/25-画像検索計画.md §4)。embedding は data 由来の派生キャッシュのため、
// いつでも再実行して整合を回復できる。モデルを差し替えたときは --force で全件
// 作り直す (ストック側とクエリ側のモデルは必ず揃える)。
// 冪等: 既に埋まっている行は飛ばす (--force で作り直す)。
//
// 使い方: npm run backfill:embeddings -- [--force]
//   (直接: npx tsx --conditions=react-server scripts/backfillEmbeddings.ts [--force])
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { computeEmbeddingBytes } from '@/lib/embedding/embedImageServer'

async function main(): Promise<void> {
  const force = process.argv.includes('--force')

  // data は 1 枚数 MB ありうるので、名前だけ先に引いて 1 枚ずつ読む
  // (backfillThumbs.ts と同じ。全画像の原寸を一度に載せない)。
  const names = await prisma.image.findMany({
    where: force ? {} : { embedding: null },
    select: { name: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`対象: ${names.length} 件${force ? ' (--force: 作り直し)' : ''}`)

  let made = 0
  let failed = 0
  for (const { name } of names) {
    const image = await prisma.image.findUnique({
      where: { name },
      select: { data: true, mime: true },
    })
    if (!image) {
      // 走査中に消えた画像 (GC・永久削除)。競走であって異常ではない
      continue
    }

    const embedding = await computeEmbeddingBytes(image.data, image.mime)
    if (!embedding) {
      // computeEmbeddingBytes が理由をログに出している。作れない画像は
      // null のままで画像検索の対象から外れるだけ (検索は今までどおり動く)
      failed += 1
      continue
    }

    await prisma.image.update({ where: { name }, data: { embedding } })
    made += 1
    console.log(`  ${name}: ${embedding.byteLength} bytes`)
  }

  console.log(`生成: ${made} 件 / 生成できず: ${failed} 件`)
  if (failed > 0) {
    // モデルごと壊れていれば全件ここに落ちるので、その 1 回で気づける
    // (backfillThumbs.ts と同じ。exit 0 で素通りさせない)。
    console.log('生成できなかった画像は画像検索の対象になりません')
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
