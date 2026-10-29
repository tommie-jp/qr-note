// 控えてある回路図の SVG を軽くする (docs/124 §2)。描いて控えるときは
// circuit/optimizeSvg.ts が掛けるので、これは**それより前に控えた行**のため。
// 冪等: まだ軽くしていない行 (小数 3 桁の数を含む) だけを DB 側の正規表現で
// 選び、軽くして中身が変わった行だけを書く。軽くした後の行は選ばれないので、
// 毎回の配布で流しても 2 回目からはほぼ何もしない。
//
// hash は回路の本文から作る鍵なので、SVG を書き換えても hash は変わらない
// (端末が immutable で覚えた /api/circuits/svg/<hash> は前の SVG のままだが、
// 見た目は同じ)。
//
// 使い方: npx tsx --conditions=react-server scripts/optimizeCircuitSvgs.ts
//   (本番へは doDeploy.sh の手順 6 が SSH トンネル経由で流す)
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { optimizeCircuitSvg, UNOPTIMIZED_SVG_PATTERN } from '@/lib/circuit/optimizeSvg'

// 一度に引く行数。1 枚は大きいもので 70KB ほどあるので、メモリと往復の間を取る
const BATCH = 50

async function main(): Promise<void> {
  let after = ''
  let seen = 0
  let updated = 0
  let saved = 0
  for (;;) {
    const rows = await prisma.$queryRaw<{ hash: string; svg: string }[]>`
      SELECT hash, svg FROM circuit_svgs
      WHERE svg ~ ${UNOPTIMIZED_SVG_PATTERN} AND hash > ${after}
      ORDER BY hash
      LIMIT ${BATCH}
    `
    if (rows.length === 0) {
      break
    }
    for (const row of rows) {
      seen += 1
      const optimized = optimizeCircuitSvg(row.svg)
      if (optimized === row.svg) {
        continue
      }
      await prisma.$executeRaw`UPDATE circuit_svgs SET svg = ${optimized} WHERE hash = ${row.hash}`
      updated += 1
      saved += row.svg.length - optimized.length
    }
    after = rows[rows.length - 1].hash
  }
  console.log(`候補: ${seen} 枚 / 軽くした: ${updated} 枚 (${Math.round(saved / 1024)}KB 減)`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
