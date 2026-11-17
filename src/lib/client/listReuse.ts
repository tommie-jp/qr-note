// 取り直した一覧で、変わっていないノートは前の物を使い回す (docs/129 §2)。
//
// 一覧は 30 秒を過ぎるか書き込みの後に、読み進めた所まで丸ごと取り直す。
// 届いたノートを全部作り直すと、中身が同じでも行・プレビュー・数式が全部
// 作り直される。**ノートごとのハッシュ** (DTO の JSON の FNV-1a) が同じなら
// 前の Item をそのまま使い、全部同じなら一覧の値ごと前の物を返す
// (画面は何も描き直さない)。
//
// ハッシュは DTO の JSON から取る。サーバは toItemDto の順に項目を並べて
// 送り、端末に残した控え (listPersist.ts) も toItemDto で作るので、同じ
// ノートなら同じ文字列になる。項目の順がずれても「違う」と読むだけで、
// 作り直す (今までと同じ) に倒れる
import 'client-only'
import type { Item } from '@/generated/prisma/client'
import { reviveItem, toItemDto, type ItemDto } from '@/lib/api/itemDto'

// Item → そのハッシュ。Item は作り直さずに使い回すので、同一性で覚えられる
const hashes = new WeakMap<Item, string>()

// FNV-1a (32bit) と長さ。暗号用ではない — 同じ itemId の新旧を比べるだけ
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(16)}:${text.length}`
}

export function dtoHash(dto: ItemDto): string {
  return hashText(JSON.stringify(dto))
}

export function itemHash(item: Item): string {
  const known = hashes.get(item)
  if (known !== undefined) {
    return known
  }
  const hash = dtoHash(toItemDto(item))
  hashes.set(item, hash)
  return hash
}

// 届いた DTO を Item にする。前の一覧に同じハッシュのノートがあれば使い回す
export function reviveReusing(dtos: readonly ItemDto[], previous: readonly Item[] | undefined): Item[] {
  const byId = new Map((previous ?? []).map((item) => [item.itemId, item]))
  return dtos.map((dto) => {
    const old = byId.get(dto.itemId)
    const hash = dtoHash(dto)
    if (old !== undefined && itemHash(old) === hash) {
      return old
    }
    const item = reviveItem(dto)
    hashes.set(item, hash)
    return item
  })
}

// 2 つの配列が同じ物を同じ順に持つか
export function sameElements<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

// JSON にして同じか (回路図サムネ・付属情報。どちらも小さい)
export function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
