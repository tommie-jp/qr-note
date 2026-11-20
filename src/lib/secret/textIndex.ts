// テキスト断片の一覧と、暗号文のまとめ取り
// (docs/130-シークレット内検索計画.md §5-1)。
//
// **どちらも検索語を受け取らない**。返すのは「全件の一覧」と「名前で指した
// 暗号文」だけで、何を探しているかも、どれが一致したかもサーバには届かない。
// secret/store.ts と同じく、この層は中身を解釈しない (鍵はサーバに無い)。

import 'server-only'
import { Prisma, type Item } from '@/generated/prisma/client'
import { prisma } from '../db'
import { SECRET_TEXT_MIME } from './payload'
import type { SecretTextEntry } from './search'
import { allSecretNames, SECRET_PATH_PREFIX } from './secrets'
import { buildSecretTextIndex, type SecretRefItem, type SecretTextRow } from './textRefs'

// シークレット内検索が端末に渡す材料 (docs/130 §5-1・docs/131 §4-1)
export interface SecretSearchMaterial {
  // 参照元のあるテキスト断片の一覧
  entries: SecretTextEntry[]
  // シークレットを含む、ゴミ箱でないノート。一致を通常の一覧の行として描く材料
  items: Item[]
}

// 参照元のあるテキスト断片の一覧と、シークレットを含むノート。
//
// ハッシュは都度 sha256(data) で計算する。`secrets` に更新日時の列が無いための
// 代わりで、封をし直すと IV が変わる = 暗号文が変わるので編集を検知できる。
// 列を足さないので migration が要らない (docs/130 §5-1)。
//
// 参照元は「本文に /api/secrets/ を含む、ゴミ箱でないノート」から引く。
// **LIKE ではなく position()** — PGroonga が LIKE を乗っ取るため。
//
// **ハッシュを計算するのは参照されている断片だけ。** 先にノートから名前を集め、
// その名前の行だけを引く — GC 待ちの断片 (docs/51 §11) が溜まっても、呼ぶたびに
// 全件へ sha256 を掛けない。
//
// **ノートは検索語に関係なく全部返す** (docs/131 §2)。一致したノートだけを後から
// 取らせると、「この検索語の直後にこのノートを取った」がログに並び、どのノートの
// 断片が一致したかが見えてしまう。テキスト断片を持たないノート (画像だけの断片)
// も外さない — 応答の形から「テキスト断片を持つノートはどれか」を読み取らせない
export async function listSecretTexts(): Promise<SecretSearchMaterial> {
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id
    FROM items
    WHERE deleted_at IS NULL AND position(${SECRET_PATH_PREFIX} in memo) > 0
  `
  if (ids.length === 0) {
    return { entries: [], items: [] }
  }
  const items = await prisma.item.findMany({
    where: { itemId: { in: ids.map((row) => row.id) }, deletedAt: null },
    orderBy: { itemId: 'asc' },
  })
  return { entries: await secretTextEntries(items), items }
}

async function secretTextEntries(items: readonly SecretRefItem[]): Promise<SecretTextEntry[]> {
  const names = [...new Set(items.flatMap((item) => allSecretNames(item.memo)))]
  if (names.length === 0) {
    return []
  }
  const rows = await prisma.$queryRaw<SecretTextRow[]>`
    SELECT name, encode(sha256(data), 'hex') AS hash, octet_length(data)::int AS bytes
    FROM secrets
    WHERE mime = ${SECRET_TEXT_MIME} AND name IN (${Prisma.join(names)})
    ORDER BY created_at, name
  `
  return buildSecretTextIndex(rows, items)
}

export interface SecretTextBlob {
  name: string
  data: Uint8Array
}

// 名前で指したテキスト断片の合計の大きさ。まとめ取りの上限を、暗号文を
// メモリへ読む前に確かめるために使う
export async function secretTextBytes(names: readonly string[]): Promise<number> {
  if (names.length === 0) {
    return 0
  }
  const rows = await prisma.$queryRaw<{ total: number }[]>`
    SELECT coalesce(sum(octet_length(data)), 0)::float8 AS total
    FROM secrets
    WHERE mime = ${SECRET_TEXT_MIME} AND name IN (${Prisma.join(names)})
  `
  return rows[0]?.total ?? 0
}

// 名前で指したテキスト断片の暗号文。**テキスト以外は名前を知っていても返さない**
// (画像・録画をこの口で運ばせない。それらは /api/secrets/[name] の役目)。
// 無い名前は黙って飛ばす (一覧を取った後に消えた・書式違い)。
export async function findSecretTextBlobs(names: readonly string[]): Promise<SecretTextBlob[]> {
  if (names.length === 0) {
    return []
  }
  const rows = await prisma.secret.findMany({
    where: { name: { in: [...names] }, mime: SECRET_TEXT_MIME },
    select: { name: true, data: true },
    orderBy: { name: 'asc' },
  })
  return rows.map((row) => ({ name: row.name, data: new Uint8Array(row.data) }))
}
