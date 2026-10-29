// 回路フェンスの控え (memo_circuit_fences、docs/122 §1) をまとめて埋め、
// 今のどの本文にも当たらない古い行を掃く。
//
// 控えは一覧・同期が引いたときにも埋まるので、流さなくても動く。流す意味は
// 2 つ: 配布の直後に最初の同期が数百件を解析する山を前倒しで済ませること、
// 本文を書き換えた後に残った古い行を消すこと。冪等: 何度流しても結果は同じ。
//
// ゴミ箱のノートも埋める (復元したときに解析し直さずに済む)。
//
// 使い方: npx tsx --conditions=react-server scripts/backfillCircuitFences.ts
//   (本番/デモへは ./doBackfill.sh circuit-fences 経由。リモートにはソースが無い)
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { memoHash } from '@/lib/circuit/fenceMemo'
import { extractCircuitFences, hasNoCircuitFence } from '@/lib/circuit/fences'

const PROGRESS_EVERY = 100

async function main(): Promise<void> {
  const items = await prisma.item.findMany({ select: { memo: true } })
  const wanted = new Map<string, string>()
  for (const { memo } of items) {
    if (!hasNoCircuitFence(memo)) {
      wanted.set(memoHash(memo), memo)
    }
  }
  const existing = new Set(
    (await prisma.memoCircuitFences.findMany({ select: { memoHash: true } })).map((row) => row.memoHash),
  )
  console.log(`ノート ${items.length} 件 (回路の言語名を含む本文 ${wanted.size} 種) / 控え ${existing.size} 行`)

  let added = 0
  for (const [hash, memo] of wanted) {
    if (existing.has(hash)) {
      continue
    }
    await prisma.memoCircuitFences.createMany({
      data: [{ memoHash: hash, fences: extractCircuitFences(memo) as unknown as object[] }],
      skipDuplicates: true,
    })
    added += 1
    if (added % PROGRESS_EVERY === 0) {
      console.log(`  ${added} 件を埋めた`)
    }
  }

  const stale = [...existing].filter((hash) => !wanted.has(hash))
  const { count: removed } = await prisma.memoCircuitFences.deleteMany({ where: { memoHash: { in: stale } } })

  console.log(`埋めた: ${added} 件 / 掃いた (どの本文にも当たらない行): ${removed} 件`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
