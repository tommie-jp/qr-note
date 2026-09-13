// 既存の全画像の data からサムネイルを作り images.thumb を埋める。
// thumb は data 由来の派生キャッシュのため、いつでも再実行して整合を回復できる。
// 冪等: 既に埋まっている行は飛ばす (--force で作り直す)。
//
// 使い方: npx tsx --conditions=react-server scripts/backfillThumbs.ts [--force]
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { makeThumbnail } from '@/lib/thumbnail'
import { sniffImageFormat } from '@/lib/uploads/sniff/image'

async function main(): Promise<void> {
  const force = process.argv.includes('--force')

  // data は 1 枚数 MB ありうるので、名前だけ先に引いて 1 枚ずつ読む。
  // 全画像の原寸を一度にメモリへ載せると数 GB になりかねない
  const names = await prisma.image.findMany({
    where: force ? {} : { thumb: null },
    select: { name: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`対象: ${names.length} 件${force ? ' (--force: 作り直し)' : ''}`)

  let made = 0
  let failed = 0
  let skipped = 0
  for (const { name } of names) {
    const image = await prisma.image.findUnique({
      where: { name },
      select: { data: true },
    })
    if (!image) {
      // 走査中に消えた画像 (GC・永久削除)。競走であって異常ではない
      continue
    }

    // images 表は音声・PDF・テキストなど画像でない添付も持つ
    // (attachmentStore.ts の savePlainAttachment)。これらはサムネの対象外で、
    // sharp に渡しても必ず失敗するだけなので、エラーにせず黙って飛ばす。
    // 判定は保存経路 (storeAttachment) と同じマジックバイト sniff に揃える
    if (!sniffImageFormat(image.data)) {
      skipped += 1
      continue
    }

    const thumb = await makeThumbnail(image.data, name)
    if (!thumb) {
      // makeThumbnail が理由をログに出している。作れない画像を毎回引き直しても
      // 結果は変わらないが、null のままにしておけば配信は原寸で代替できる
      failed += 1
      continue
    }

    await prisma.image.update({ where: { name }, data: { thumb } })
    made += 1
    console.log(
      `  ${name}: ${kb(image.data.byteLength)} → ${kb(thumb.byteLength)}`,
    )
  }

  console.log(
    `生成: ${made} 件 / 生成できず: ${failed} 件 / 対象外 (画像以外): ${skipped} 件`,
  )
  if (failed > 0) {
    // 作れなかった画像は一覧で原寸のまま配られる (絵は出るが重い)。
    console.log('生成できなかった画像は一覧で原寸のまま配信されます')
  }
  if (failed > 0 && made === 0) {
    // 終了コードに出すのは**全件失敗のときだけ**。cron や deploy から呼んだとき、
    // 「全部失敗したのに exit 0」だと成功として素通りしてしまう。sharp ごと
    // 壊れていれば全件ここに落ちるので、その 1 回で気づける。
    // 一部失敗は exit 0 のまま — 壊れた 1 枚が居座るだけで全実行が恒久的に
    // 失敗扱いになると、呼び出し側 (doBackfill.sh の set -e) が後続処理
    // ごと止まってしまう
    process.exitCode = 1
  }
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
