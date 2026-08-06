// DB のノートを ZIP の項目の並びに変える (docs/28-エクスポート計画.md §7)。
//
// 非同期ジェネレータにしてあるのは、**呼ぶ側が引いたぶんだけ DB を読む**ため。
// 添付は 1 件が数 MB あり、全ノート分を配列に集めると本番 VPS (RAM 2GB) では
// 足りない。zipStream.ts の背圧がそのままこの関数の歩みになる。

import { prisma } from '@/lib/db'
import { attachmentEntryPath, noteEntryPath } from './layout'
import { buildNoteFile, collectAttachmentNames, type PortableNote } from './noteFile'
import type { ZipEntry } from './zipStream'

// ノート本文をまとめて引く単位。1 件は最大 10000 文字 (MAX_TEXT_LENGTH) なので、
// 100 件で数 MB に収まる。全件を 1 回で引くと数千件規模でここだけが重くなる
const NOTE_BATCH = 100

// ZIP に入れる項目を順に返す。itemNos が null なら全ノート。
//
// ゴミ箱 (deletedAt 非 null) は含めない (docs/28 §6)。選択エクスポートに
// ゴミ箱のノートが紛れることは UI 上ないが、番号を直接送られても入らない。
export async function* exportEntries(
  itemNos: readonly string[] | null,
): AsyncGenerator<ZipEntry> {
  const targets = itemNos ?? (await allItemNos())

  // 添付は本文を全部読んでから集める。複数のノートが同じ画像を指すことがある
  // (docs/20-画像GC計画.md §1) ので、名前で重複を落としてから 1 回だけ入れる
  const attachments = new Set<string>()

  for (let start = 0; start < targets.length; start += NOTE_BATCH) {
    const batch = targets.slice(start, start + NOTE_BATCH)
    const rows = await fetchNotes(batch)
    for (const itemNo of batch) {
      const row = rows.get(itemNo)
      if (row === undefined) {
        // 消えた・ゴミ箱に入った番号。読み取りだけの操作なので、黙って外す
        // のではなくログに残して先へ進む (利用者に返す口が無い)
        console.warn(`エクスポート対象のノートが見つかりません: ${itemNo}`)
        continue
      }
      for (const name of collectAttachmentNames(row.memo)) {
        attachments.add(name)
      }
      yield {
        path: noteEntryPath(row.itemNo),
        data: encodeText(buildNoteFile(toPortableNote(row))),
        compress: true,
        // 手元に展開したとき元の更新順が残る
        mtime: row.updatedAt,
      }
    }
  }

  for (const name of attachments) {
    const entry = await fetchAttachment(name)
    if (entry !== null) {
      yield entry
    }
  }
}

interface NoteRow {
  itemNo: string
  memo: string
  url: string
  mode: 'memo' | 'url'
  createdAt: Date
  updatedAt: Date
  publicAt: Date | null
}

async function allItemNos(): Promise<string[]> {
  // 番号の若い順。人が手元で開いたときに並びが自然になる
  // (非数字の itemNo は itemNoNum が null で末尾に回る)
  const rows = await prisma.item.findMany({
    where: { deletedAt: null },
    select: { itemNo: true },
    orderBy: [{ itemNoNum: 'asc' }, { itemNo: 'asc' }],
  })
  return rows.map((row) => row.itemNo)
}

// 指定した番号のノートを引く。**並び順は呼ぶ側 (選択順) を正とする**ので、
// 番号で引ける形で返す
async function fetchNotes(itemNos: string[]): Promise<Map<string, NoteRow>> {
  const rows = await prisma.item.findMany({
    where: { itemNo: { in: itemNos }, deletedAt: null },
    select: {
      itemNo: true,
      memo: true,
      url: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
      publicAt: true,
    },
  })
  return new Map(rows.map((row) => [row.itemNo, row]))
}

// 添付 1 件。**1 件ずつ引く** — まとめて引くと数十 MB がいちどに載る
async function fetchAttachment(name: string): Promise<ZipEntry | null> {
  const row = await prisma.image.findUnique({
    where: { name },
    select: { data: true },
  })
  if (row === null) {
    // 本文が指しているのに行が無い。画像 GC の取りこぼしや手動削除で起きうる。
    // ここで落とすと「1 枚欠けただけで全件が書き出せない」になるので、
    // ログに残して続ける (本文の参照はそのまま = 戻せば元の状態に戻る)
    console.warn(`本文が参照する添付が見つかりません: ${name}`)
    return null
  }
  return {
    path: attachmentEntryPath(name),
    data: row.data,
    // jpg/webp/mp4/pdf は既に圧縮済み。縮まないうえ CPU とメモリを食う
    compress: false,
  }
}

function toPortableNote(row: NoteRow): PortableNote {
  return {
    itemNo: row.itemNo,
    memo: row.memo,
    url: row.url,
    mode: row.mode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // 公開した日時までは持ち出さない。戻すときに要るのは「公開かどうか」だけ
    isPublic: row.publicAt !== null,
  }
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
