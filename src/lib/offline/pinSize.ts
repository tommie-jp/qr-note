// 印を付けたときに端末へ落ちる量 (docs/65-オフライン対応計画.md §7)。
//
// **サーバ専用**。prisma を読むので、クライアントから import してはいけない
// (syncItems.ts と同じ理由)。
//
// なぜ量を数えるのか: 印は通信量と端末の保存容量を払う判断で、押した後に
// 判っても遅い。30MB の動画が入ったノートと、文字だけのノートを同じ顔で
// 並べると、押した人が驚くことになる。
//
// images に大きさの列は無いので octet_length() で数える。派生の列を足して
// 保存時に埋めるほどの用途ではない (ノートを開いたときに 1 度だけ、しかも
// 添付を持つノートだけが払う)。

import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db'
import { allAttachments } from '@/lib/memoImages'
import { allSecretNames } from '@/lib/secrets'

interface SizeRow {
  bytes: bigint | null
}

// 本文が参照する添付とシークレット断片の合計バイト数。
//
// **サムネは数えない。** 原寸に比べれば誤差 (数十 KB) で、足すと「何の量か」が
// ぼやける。数えたいのは「この印を付けると何 MB 増えるか」の桁である。
//
// 数えられなかったとき (DB が落ちている) は 0 を返す。ここは表示のためだけの
// 値で、出せないことでトグルまで止める理由が無い。
export async function pinAttachmentBytes(memo: string): Promise<number> {
  const attachmentNames = allAttachments(memo).map(({ name }) => name)
  const secretNames = allSecretNames(memo)

  const [attachments, secrets] = await Promise.all([
    sumBytes('images', attachmentNames),
    sumBytes('secrets', secretNames),
  ])
  return attachments + secrets
}

async function sumBytes(table: 'images' | 'secrets', names: readonly string[]): Promise<number> {
  if (names.length === 0) {
    return 0
  }
  // 表の名前は呼び出し側の型で 2 つに限っているので埋め込みでよい
  // (識別子はプレースホルダにできない)。名前の一覧だけをパラメータで渡す
  const from = table === 'images' ? Prisma.sql`images` : Prisma.sql`secrets`
  const rows = await prisma
    .$queryRaw<SizeRow[]>`
      SELECT SUM(octet_length(data))::bigint AS bytes
      FROM ${from}
      WHERE name IN (${Prisma.join([...names])})
    `
    .catch((error: unknown) => {
      console.warn(`${table} の大きさを数えられませんでした`, error)
      return [] as SizeRow[]
    })

  // SUM は行が 1 つも当たらないと NULL を返す (0 ではない)
  return Number(rows[0]?.bytes ?? 0)
}
