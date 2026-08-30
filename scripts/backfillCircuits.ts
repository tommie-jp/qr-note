// 既存の全ノートの ```circuitikz フェンスを描画して circuit_svgs を埋める。
//
// 一覧の回路図サムネ (src/lib/circuitThumbs.ts) は「キャッシュを引くだけ」で
// 描画しないため、一度も開かれていないノートの図はこれを流すまでサムネに
// 出ない (docs/68-一覧回路図サムネ計画.md §6)。導入時に 1 回流せば、以後は
// ノートの表示時に描かれて自然に揃う。
//
// 冪等: 描画済みの図は先に除外して飛ばす。SVG はソース + レンダラ版の hash が
// 主キーの派生データなので、何度流しても壊れない。
//
// 使い方: npx tsx scripts/backfillCircuits.ts
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { getOrRenderCircuit, MAX_CIRCUITS_PER_MEMO } from '@/lib/circuitCache'
import { CIRCUITIKZ_LANG, extractCircuitSources } from '@/lib/circuitFences'
import { circuitHash } from '@/lib/circuitikz'

async function main(): Promise<void> {
  // ゴミ箱も含めた全ノート (ゴミ箱の一覧にもサムネは出る)。
  // フェンスの有無は SQL で絞らず JS で見る — PGroonga が LIKE を乗っ取って
  // いる環境では contains の意味が変わりうるし、memo 全件でもたかが知れている
  const items = await prisma.item.findMany({
    select: { itemNo: true, memo: true },
    orderBy: { itemNoNum: 'asc' },
  })

  // 同じ図が複数ノートにあっても 1 回で済むよう hash で束ねる。
  // 9 個目以降のフェンスは表示側 (renderCircuits) が描かないので対象外
  const sources = new Map<string, string>()
  for (const item of items) {
    if (!item.memo.includes(CIRCUITIKZ_LANG)) {
      continue
    }
    const fences = extractCircuitSources(item.memo).slice(
      0,
      MAX_CIRCUITS_PER_MEMO,
    )
    for (const source of fences) {
      sources.set(circuitHash(source), source)
    }
  }
  console.log(`全 ${items.length} ノート中、回路図は ${sources.size} 図`)

  // 描画済みを除外 (描画は 1 図 1 秒強。引くだけで済む物に使う時間はない)
  const cached = await prisma.circuitSvg.findMany({
    where: { hash: { in: [...sources.keys()] } },
    select: { hash: true },
  })
  for (const { hash } of cached) {
    sources.delete(hash)
  }
  console.log(`未描画: ${sources.size} 図 (描画済み ${cached.length} 図は飛ばす)`)

  let made = 0
  let failed = 0
  for (const source of sources.values()) {
    // どの図を描いているか判るよう 1 行目だけ添える (ソースは複数行)
    const head = source.split('\n', 1)[0].slice(0, 60)
    try {
      await getOrRenderCircuit(source)
      made += 1
      console.log(`  描画: ${head}`)
    } catch (e) {
      // TeX の文法エラー等は何度流しても同じ失敗をするだけ。ノートを開けば
      // エラーと TeX ログが本人に見える (CircuitDiagram) ので、ここは数えて進む
      failed += 1
      console.error(`  失敗: ${head} — ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log(`描画: ${made} 図 / 失敗: ${failed} 図`)
  if (failed > 0 && made === 0) {
    // 終了コードに出すのは**全件失敗のときだけ** (backfillThumbs.ts と同じ理由)。
    // レンダラごと壊れていれば全件ここに落ちるので、その 1 回で気づける
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
