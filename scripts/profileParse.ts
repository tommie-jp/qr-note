// 回路フェンス解析の CPU プロファイルを Next の外で取る (docs/121-QR-Noteベンチマーク計画.md §5)。
//
// 画面の「サーバを計測」が残す cpuprofile は本番ビルドの束ね
// (.next/server/chunks/) の中なので、npm モジュールの出どころが読みにくい。
// ここは素の node_modules を読むので、remark-parse / remark-gfm /
// remark-math などのどれが重いかがファイル名のまま出る。
//
// 本文は手元の DB の回路ノート (画面と同じ選び方: id 順に N 件) を使う。
// 計測の部品は画面と同じ lib/diag/parseBench.ts。
//
// 使い方:
//   npx tsx --conditions=react-server --cpu-prof --cpu-prof-dir=prof scripts/profileParse.ts [件数] [周回]
//   → prof/*.cpuprofile を Chrome DevTools の Performance (Load profile) で開く
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { BENCH_FIXTURE_MD } from '@/lib/diag/benchFixture'
import { parseBatch } from '@/lib/diag/parseBench'

const DEFAULT_ITEMS = 200
const DEFAULT_ROUNDS = 5

function positiveInt(arg: string | undefined, fallback: number): number {
  const n = Number(arg)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

async function main(): Promise<void> {
  const items = positiveInt(process.argv[2], DEFAULT_ITEMS)
  const rounds = positiveInt(process.argv[3], DEFAULT_ROUNDS)
  // 判定は position — LIKE は PGroonga が乗っ取る
  const rows = await prisma.$queryRaw<{ memo: string }[]>`
    SELECT memo FROM items
    WHERE deleted_at IS NULL AND position('circuit' in memo) > 0
    ORDER BY id
    LIMIT ${items}
  `
  const memos = rows.length > 0 ? rows.map((r) => r.memo) : [BENCH_FIXTURE_MD]
  const kb = Math.round(memos.reduce((sum, m) => sum + Buffer.byteLength(m), 0) / 1024)
  console.log(`${memos.length} 件 (${kb}KB) を ${rounds} 周解析します`)

  for (let round = 1; round <= rounds; round += 1) {
    // 1 件ごとに譲らない (Next の外なので塞いで困る要求が無い)
    const r = await parseBatch(memos, { yieldEvery: memos.length })
    const stages = Object.entries(r.stages)
      .map(([name, ms]) => `${name}=${ms.toFixed(1)}ms`)
      .join(' ')
    console.log(`${round} 周目: 全体=${r.totalMs.toFixed(1)}ms (1 件 ${(r.totalMs / memos.length).toFixed(2)}ms) ${stages} 図=${r.fences}`)
  }
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
