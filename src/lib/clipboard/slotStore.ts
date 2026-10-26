// サーバ経由のクリップボードの読み書き (docs/114-サーバクリップボード計画.md)。
// 型・期限・ラベルの規則は clipboard/slot.ts が持つ。
//
// **userName で仕切るのが要点**。呼び出し側 (route) はセッションから取った名前を渡す —
// リクエストの本文で名乗らせない (prefs/userSettingStore.ts と同じ流儀)。
//
// **1 枠・上書き。** 文字か画像のどちらか一方だけが入る。「どちらか 1 つ」は表の形では
// なくここで守る — 書くたびに、使わないほうの列を明示的に null にする。
//
// **期限切れは読むときと書くときに消す。** 掃除用の常駐は置かない (vps2 のメモリが
// 逼迫している)。読まれない枠は読み出しの掃除が働かないので、誰かが書くついでに
// 期限切れの行をまとめて消す (writeSlot)。置いたきりの平文を、次に誰かが書くまで
// 残すことはあるが、1 人 1 行・最大 10MB で、書くのは利用者の操作だけ。
//
// **サーバ専用。** prisma を掴むので、クライアント部品から import しないこと

import 'server-only'
import { prisma } from '@/lib/db'
import {
  CLIPBOARD_TTL_MS,
  type ClipboardSlotMeta,
  isSlotExpired,
  kindOfMime,
  textByteLength,
} from './slot'

interface SlotColumns {
  text: string | null
  mime: string | null
  data: Uint8Array<ArrayBuffer> | null
  name: string | null
  thumb: Uint8Array<ArrayBuffer> | null
  preview: string | null
  bytes: number
}

// 置くときに一緒に置く見本 (docs/115)。作れなかったものは null
export interface SlotPreviewColumns {
  readonly thumb?: Uint8Array<ArrayBuffer> | null
  readonly preview?: string | null
}

// メタを組むのに読む列。本体の data (最大 30MB) は読まない。見本の絵 (数十 KB) は
// hasThumb を決めるのに読む
const META_SELECT = {
  text: true,
  mime: true,
  name: true,
  bytes: true,
  updatedAt: true,
  thumb: true,
  preview: true,
} as const

export async function readSlotMeta(
  userName: string,
  now: Date = new Date(),
): Promise<ClipboardSlotMeta | null> {
  // 本体 (最大 30MB) は読まない。大きさは bytes 列にある
  const row = await prisma.clipboardSlot.findUnique({ where: { userName }, select: META_SELECT })
  if (row === null) {
    return null
  }
  if (isSlotExpired(row.updatedAt, now)) {
    await clearExpiredSlot(userName, row.updatedAt)
    return null
  }
  return metaOf(row)
}

// 枠のファイル (なんでも)。種類は mime が決める
export interface SlotMedia {
  readonly mime: string
  readonly data: Uint8Array
  // 元のファイル名 (整形済み)。無いこともある
  readonly name: string | null
}

// ファイルの中身。文字の枠・無い・期限切れはどれも null (呼ぶ側は 404 にする)
export async function readSlotMedia(
  userName: string,
  now: Date = new Date(),
): Promise<SlotMedia | null> {
  const row = await prisma.clipboardSlot.findUnique({ where: { userName } })
  if (row === null) {
    return null
  }
  if (isSlotExpired(row.updatedAt, now)) {
    await clearExpiredSlot(userName, row.updatedAt)
    return null
  }
  if (row.mime === null || row.data === null) {
    return null
  }
  return { mime: row.mime, data: row.data, name: row.name }
}

export async function writeSlotText(userName: string, text: string): Promise<ClipboardSlotMeta> {
  return writeSlot(userName, {
    text,
    mime: null,
    data: null,
    name: null,
    thumb: null,
    preview: null,
    bytes: textByteLength(text),
  })
}

export async function writeSlotMedia(
  userName: string,
  mime: string,
  data: Uint8Array<ArrayBuffer>,
  // 整形済みの名前 (sanitizeFileName)。呼ぶ側が通すこと — ここでは信じて置く
  name: string | null = null,
  { thumb = null, preview = null }: SlotPreviewColumns = {},
): Promise<ClipboardSlotMeta> {
  return writeSlot(userName, { text: null, mime, data, name, thumb, preview, bytes: data.byteLength })
}

// 見本の絵 (WebP)。無い・期限切れ・文字の枠は null
export async function readSlotThumb(
  userName: string,
  now: Date = new Date(),
): Promise<Uint8Array | null> {
  const row = await prisma.clipboardSlot.findUnique({
    where: { userName },
    select: { thumb: true, updatedAt: true },
  })
  if (row === null) {
    return null
  }
  if (isSlotExpired(row.updatedAt, now)) {
    await clearExpiredSlot(userName, row.updatedAt)
    return null
  }
  return row.thumb
}

export type AttachThumbResult =
  | { readonly status: 'ok'; readonly meta: ClipboardSlotMeta }
  // 見た版の後に別の端末が置き直した。古いファイルの絵を新しい枠に付けない
  | { readonly status: 'stale' }
  // 枠が無い・期限切れ・文字の枠
  | { readonly status: 'missing' }

// クライアントが作った見本の絵 (動画の先頭コマ・PDF の 1 ページ目) を後から貼る (docs/115 §1-3)。
// thumb は呼ぶ側が makeThumbnail で作り直したもの。
//
// **版 (updatedAt) が合うときだけ貼る。** 合っているかは where で確かめる (読んでから
// 書くまでの間に置き直されても、古い絵は付かない)。
// **updatedAt を進めない。** Prisma の @updatedAt は update のたびに今の時刻を書くので、
// 見た版を明示して書き戻す。進めると期限 (10 分) が延び、版もずれる
export async function attachSlotThumb(
  userName: string,
  version: Date,
  thumb: Uint8Array<ArrayBuffer>,
  now: Date = new Date(),
): Promise<AttachThumbResult> {
  const row = await prisma.clipboardSlot.findUnique({ where: { userName }, select: META_SELECT })
  if (row === null || row.text !== null || row.mime === null) {
    return { status: 'missing' }
  }
  if (isSlotExpired(row.updatedAt, now)) {
    await clearExpiredSlot(userName, row.updatedAt)
    return { status: 'missing' }
  }
  if (row.updatedAt.getTime() !== version.getTime()) {
    return { status: 'stale' }
  }
  const { count } = await prisma.clipboardSlot.updateMany({
    where: { userName, updatedAt: version, text: null },
    data: { thumb, updatedAt: version },
  })
  if (count === 0) {
    return { status: 'stale' }
  }
  const meta = metaOf({ ...row, thumb })
  return meta === null ? { status: 'missing' } : { status: 'ok', meta }
}

// 無くても投げない (deleteMany)。「消す」の二度押しや、期限切れと手で消すの競合で
// 片方が空振りしても、利用者に見せる失敗ではない
export async function clearSlot(userName: string): Promise<void> {
  await prisma.clipboardSlot.deleteMany({ where: { userName } })
}

// 期限切れを見つけたときの削除。**見たその版だけ**を消す (updatedAt が一致する行)。
// userName だけで消すと、見つけてから消すまでの間に別の端末が書き直した新しい中身まで
// 消してしまう
export async function clearExpiredSlot(userName: string, seenUpdatedAt: Date): Promise<void> {
  await prisma.clipboardSlot.deleteMany({ where: { userName, updatedAt: seenUpdatedAt } })
}

// 期限切れの行を全員分まとめて消す。表は 1 人 1 行なので、索引なしの走査で足りる
async function sweepExpired(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - CLIPBOARD_TTL_MS)
  // isSlotExpired は「ちょうど 10 分」も切れとするので lte
  await prisma.clipboardSlot.deleteMany({ where: { updatedAt: { lte: cutoff } } })
}

async function writeSlot(userName: string, columns: SlotColumns): Promise<ClipboardSlotMeta> {
  // 先に掃除する。あとで掃除すると、いま書いた行を巻き込みうる
  await sweepExpired(new Date())
  const row = await prisma.clipboardSlot.upsert({
    where: { userName },
    create: { userName, ...columns },
    update: columns,
  })
  const meta = metaOf(row)
  if (meta === null) {
    throw new Error('クリップボードの枠の種類を決められません')
  }
  return meta
}

function metaOf(row: {
  text: string | null
  mime: string | null
  name: string | null
  thumb: Uint8Array | null
  preview: string | null
  bytes: number
  updatedAt: Date
}): ClipboardSlotMeta | null {
  const updatedAt = row.updatedAt.toISOString()
  if (row.text !== null) {
    return { kind: 'text', bytes: row.bytes, updatedAt, text: row.text }
  }
  // 種類は mime から決まる。mime が無い・知らない行は壊れた行なので「無い」と見なす
  // (サーバは classifySlotFile を通った mime しか置かない)
  const kind = row.mime === null ? null : kindOfMime(row.mime)
  return kind === null || row.mime === null
    ? null
    : {
        kind,
        bytes: row.bytes,
        updatedAt,
        mime: row.mime,
        ...(row.name ? { name: row.name } : {}),
        ...(row.thumb ? { hasThumb: true } : {}),
        ...(row.preview ? { preview: row.preview } : {}),
      }
}
