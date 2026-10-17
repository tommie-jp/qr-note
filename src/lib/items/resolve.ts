// URL のノート指定を id に解く (docs/107-ノート主キー計画.md §3-2)。
//
// ノートの主キーは UUID v7 になったが、印刷済みの QR シール
// (`http://qr.tommie.jp/item/1003`)・X に投稿済みの公開 URL・教科書の ZIP の
// 本文リンク (`/item/wb01-03-08`) は旧番号のまま残る。旧番号は移行で本文の
// タグ `#1003` になったので、**タグで引き直す**。列は残していない — 番号を
// JAN や DataMatrix と同じ「本文に書いたコード」として扱うのがこの計画の要点で、
// 2 つ目の識別子を持つと元に戻ってしまう。
//
// 解き方は 1 本:
//   UUID            → そのノート
//   旧番号の形      → タグ #<旧番号> のノートが 1 件ならそれ、
//                     0 件・複数ならタグ検索 (/?q=%23<旧番号>) に任せる
//   それ以外        → 404
import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db'
import { normalizeTag, tagSearchHref } from '@/lib/markdown/tags/tags'
import { isLegacyItemNo, isValidItemId } from '@/lib/validation'

export type ItemKeyResolution =
  | { kind: 'id'; itemId: string }
  // 旧番号で 1 件に決まった。呼ぶ側は id の URL へ付け替える
  | { kind: 'legacy'; itemId: string }
  // 旧番号だが 1 件に決まらない (0 件・複数)。検索に任せる
  | { kind: 'search'; href: string }
  | { kind: 'invalid' }

// 旧番号のタグを持つノートの id。多くても 2 件まで引く (1 件に決まるかだけ見る)。
//
// ゴミ箱は既定で外す。シールを読んでゴミ箱のノートに着くより、検索の 0 件画面の
// 「ゴミ箱に一致があります」(docs/12 §5) に任せたほうが状況が伝わる。
// ZIP の取り込みは「その番号の行が既にあるか」を見たいので、ゴミ箱も含める
//
// publicOnly は未ログインの人のため。非公開ノートまで引いて付け替えると、
// 「その番号のタグを持つノートが 1 件だけある」ことと id が外から判ってしまう
// (いままでは未登録・非公開・ゴミ箱を同じ応答に潰していた。ItemDetail と同じ考え方)。
// 公開ノートだけで引き、決まらなければ検索 → ログイン画面に任せる
export async function findItemIdsByLegacyNo(
  itemNo: string,
  options: { includeTrashed?: boolean; publicOnly?: boolean } = {},
): Promise<string[]> {
  const trashed = options.includeTrashed ? Prisma.empty : Prisma.sql`AND deleted_at IS NULL`
  const visible = options.publicOnly ? Prisma.sql`AND public_at IS NOT NULL` : Prisma.empty
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM items
    WHERE tags @> ARRAY[${normalizeTag(itemNo)}]::text[] ${trashed} ${visible}
    ORDER BY id
    LIMIT 2
  `
  return rows.map((row) => row.id)
}

export async function resolveItemKey(
  key: string,
  options: { publicOnly: boolean },
): Promise<ItemKeyResolution> {
  if (isValidItemId(key)) {
    return { kind: 'id', itemId: key }
  }
  if (!isLegacyItemNo(key)) {
    return { kind: 'invalid' }
  }
  const ids = await findItemIdsByLegacyNo(key, { publicOnly: options.publicOnly })
  return ids.length === 1
    ? { kind: 'legacy', itemId: ids[0] }
    : { kind: 'search', href: legacySearchHref(key) }
}

// **タグ検索** (`#1250`) に倒す (docs/111 §7)。全文検索 (`1250`) だと本文に同じ数字を
// 含むノート (型番・年など) まで混ざり、番号のノートを選ぶ一覧にならない。
// 0 件なら検索の 0 件画面に「#<番号> を新規登録」が出る (docs/10 §3。
// 検索語が #付きでも registerCodeOf が剥がす)。複数なら一覧から選んでもらう
export function legacySearchHref(itemNo: string): string {
  return tagSearchHref(itemNo)
}
