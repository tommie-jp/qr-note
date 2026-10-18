// 保存済みの写真と動画から撮影情報 (位置・日時・機種など) を抜く
// (docs/113-写真の撮影情報削除計画.md §2-6 / §10)。
//
// 保存時の削除 (attachments/storeImage.ts・storeVideo.ts) より前に入ったものが対象。名前は変えず
// images.data だけを差し替える — 名前はランダムな UUID で中身に依存しないので、
// 本文の参照 (/api/images/<名前>) はそのまま生きる。サムネ・画像検索の埋め込みは
// 画素から作った派生物で、画素は変わらないので作り直さない。動画 (MP4 / MOV) は
// 撮影情報の箱を同じ長さの free にするだけなので、長さも再生位置も変わらない。
// 動画は作り直す手段 (ffmpeg) を持たないので、箱が読めなければ手を付けずに数える。
//
// 「残す」の設定とは独立に動く。持ち主が明示的に流す操作なので、残したい人は
// 流さなければよい。
//
// 使い方:
//   npx tsx --conditions=react-server scripts/backfillPhotoMeta.ts [--dry-run]
//
//   --dry-run  書き換えずに、何が何件残っているかだけを数える。座標などの
//              値そのものは出さない (出力をどこかへ貼っても漏れないように)
//
// 冪等: 抜くものが無い写真・動画は書かない。2 回目は 0 件になる。
// 本番へは ./doBackfill.sh photometa (下見は photometa-check) で流す。

import 'dotenv/config'
import { prisma } from '@/lib/db'
import {
  analyzePhotoMeta,
  isPhotoFormat,
  type MetaKind,
  stripPhotoMeta,
  type StripOutcome,
} from '@/lib/images/photoMeta'
import { stripVideoMeta } from '@/lib/video/videoMeta'

// 素通しで保存する画像 5 形式と、撮影情報を持ちうる動画 2 形式の MIME
// (uploads/names.ts の配信 MIME と同じ)。WebM (ブラウザの録画) はカメラが書かないので外す
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
const VIDEO_EXTS = new Set(['mp4', 'mov'])
const TARGET_MIMES = [...PHOTO_MIMES, 'video/mp4', 'video/quicktime']

const KIND_LABELS: Readonly<Record<MetaKind, string>> = {
  gps: '位置 (GPS)',
  datetime: '撮影日時',
  camera: '機種',
  exif: 'その他の EXIF',
  xmp: 'XMP',
  iptc: 'IPTC',
  comment: 'コメント',
  trailer: '末尾の付け足し (Motion Photo など)',
  other: 'その他の付帯情報',
}

const USAGE = '使い方: npx tsx --conditions=react-server scripts/backfillPhotoMeta.ts [--dry-run]'

// 1 件は必ずどれか 1 つに数える (下見と本番で同じ欄に入る)
interface Tally {
  // 撮影情報を抜いた (下見では「抜く予定」)
  changed: number
  clean: number
  // 区画を読めず sharp で作り直した (下見では「作り直す予定」)
  reencoded: number
  // 書き換えに失敗した・動画の箱が読めず触れなかった
  failed: number
  kinds: Map<MetaKind, number>
}

async function processOne(name: string, dryRun: boolean, tally: Tally): Promise<void> {
  const ext = name.slice(name.lastIndexOf('.') + 1)
  // 写真なら形式、動画なら null
  const photo = isPhotoFormat(ext) ? ext : null
  if (photo === null && !VIDEO_EXTS.has(ext)) {
    return
  }
  const row = await prisma.image.findUnique({ where: { name }, select: { data: true } })
  if (!row) {
    return // 走査中に消えた (GC・永久削除)。競走であって異常ではない
  }
  const data = new Uint8Array(row.data)

  let outcome: StripOutcome
  try {
    outcome = photo === null ? stripVideoMeta(data) : analyzePhotoMeta(data, photo)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (photo === null) {
      // 動画は作り直せない。撮影情報が残っている恐れがあるので数えて知らせる
      console.log(`  ${name}: 箱を読めないので触らない (${reason})`)
      tally.failed += 1
      return
    }
    console.log(`  ${name}: 区画を読めない (${reason})${dryRun ? ' → 作り直す予定' : ' → 作り直す'}`)
    const ok = dryRun || (await rewrite(name, data, () => stripPhotoMeta(data, photo)))
    tally[ok ? 'reencoded' : 'failed'] += 1
    return
  }

  if (outcome.bytes === data) {
    tally.clean += 1
    return
  }
  for (const kind of outcome.removed) {
    tally.kinds.set(kind, (tally.kinds.get(kind) ?? 0) + 1)
  }
  const labels = [...outcome.removed].map((kind) => KIND_LABELS[kind]).join('・')
  console.log(`  ${name}: ${labels} (${kb(data.byteLength)} → ${kb(outcome.bytes.byteLength)})`)
  const ok = dryRun || (await rewrite(name, data, async () => outcome.bytes))
  tally[ok ? 'changed' : 'failed'] += 1
}

// 書き換えられたら true。1 件の失敗で全体を止めない (原因はログに残す)
async function rewrite(
  name: string,
  data: Uint8Array,
  produce: () => Promise<Uint8Array<ArrayBuffer>>,
): Promise<boolean> {
  try {
    const bytes = await produce()
    await prisma.image.update({ where: { name }, data: { data: bytes } })
    return true
  } catch (error) {
    console.error(`  ${name}: 書き換えられませんでした (${kb(data.byteLength)}):`, error)
    return false
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  if (args.some((arg) => arg !== '--dry-run')) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }

  // data は 1 枚数 MB ありうるので、名前だけ先に引いて 1 枚ずつ読む
  // (backfillThumbs.ts と同じ。本番 VPS は RAM 2GB)
  const names = await prisma.image.findMany({
    where: { mime: { in: TARGET_MIMES } },
    select: { name: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`対象: 写真と動画 ${names.length} 件${dryRun ? ' (--dry-run: 書き換えない)' : ''}`)

  const tally: Tally = { changed: 0, clean: 0, reencoded: 0, failed: 0, kinds: new Map() }
  for (const { name } of names) {
    await processOne(name, dryRun, tally)
  }

  const verb = dryRun ? '抜く予定' : '抜いた'
  console.log(
    `${verb}: ${tally.changed} 件 / 撮影情報なし: ${tally.clean} 件 / 作り直し (写真): ${tally.reencoded} 件 / 失敗: ${tally.failed} 件`,
  )
  for (const [kind, count] of [...tally.kinds].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${KIND_LABELS[kind]}: ${count} 件`)
  }
  // 全件失敗のときだけ exit 1 (backfillThumbs.ts と同じ理由)。2 回目以降は
  // 「抜いた」が 0 になるのが正常なので、それだけでは失敗にしない — 読めない
  // 動画が 1 本居座るだけで毎回 exit 1 になり、doBackfill.sh (set -e) が
  // --demo の 2 つ目の DB (種) を飛ばしてしまう
  if (tally.failed > 0 && tally.changed + tally.clean + tally.reencoded === 0) {
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
