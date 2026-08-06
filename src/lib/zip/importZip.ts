// 書き出した ZIP を取り込んでノートを戻す (docs/28-エクスポート計画.md §3)。
//
// ここは**繋ぎ役だけ**を持つ。展開は readZip、1 枚の Markdown の解釈は
// noteFile、添付の検証と保存は attachmentStore、派生キャッシュ (tags / props)
// の再計算は upsertItem —— どれも既にある経路をそのまま通す。インポート専用の
// 保存経路を作らないのが設計の要 (§4 の方針をそのまま引き継ぐ)。
//
// 失敗の扱いは ENEX と同じ「そのファイルだけ飛ばしてレポートに載せる」。
// **入らなかったものは必ずレポートに出す** — 黙って落とすと、利用者は全ノートを
// 目視するまで欠落に気づけない。

import { restoreAttachment } from '@/lib/attachmentStore'
import { ownedBytes } from '@/lib/bytes'
import { prisma } from '@/lib/db'
import type { BaseImportReport } from '@/lib/importReport'
import { applyImportedTimestamps, setItemPublic, upsertItem } from '@/lib/items'
import { isValidImageName } from '@/lib/uploads'
import { classifyEntry } from './layout'
import { MAX_ZIP_NOTE_BYTES } from './limits'
import { collectAttachmentNames, parseNoteFile, type PortableNote } from './noteFile'
import { readZipStream, ZipReadError } from './readZip'

// 本文は UTF-8 で書き出している (buildNoteFile)。使い回してよい
const DECODER = new TextDecoder()

export interface ZipImportOptions {
  // 同じ番号のノートが既にあるとき上書きするか (既定: 上書きしない)。
  //
  // 既定を「見送る」にしてあるのは §5 の判断 — 戻す操作で手元の編集を黙って
  // 潰すほうが取り返しがつかない。上書きは利用者が明示的に選んだときだけ。
  overwrite?: boolean
}

export interface ZipImportReport extends BaseImportReport {
  // 既にある番号を上書きせずに見送った数。skipped とは分けて数える —
  // 「失敗して入らなかった」ではなく「あえて入れなかった」で、
  // 既定のポリシーどおりに動いた正常な結果だから
  conflictSkipped: number
  // 新しく入れた添付の数 (既に同じ名前があったものは数えない)
  restoredAttachments: number
}

// ZIP 1 ファイルを取り込む。入力は**バイト列の並び** (アップロードの本文を
// そのまま流す) で、ファイル全体をメモリに載せない。
//
// ZIP として読めない・大きすぎるファイルは**例外**を投げる (ファイル 1 枚
// まるごとが対象外)。個々のノート・添付の失敗は例外にせずレポートへ載せる。
export async function importZip(
  source: AsyncIterable<Uint8Array>,
  options: ZipImportOptions = {},
): Promise<ZipImportReport> {
  const report: ZipImportReport = {
    imported: [],
    skipped: [],
    conflictSkipped: 0,
    restoredAttachments: 0,
    deferredImageIndex: 0,
  }

  // **添付は届いたそばから保存し、ノートは溜めて後で入れる。**
  //
  // 順序の要件は「添付 → ノート」(逆にすると、取り込んだ直後の一覧で画像が
  // 割れて見える瞬間ができる) だが、書き出した ZIP はノートが先に並んでいる。
  // かといって全部を読み終えてから処理すると 500MB がまるごと載る。
  // **小さいほう (ノート本文) だけを待たせる**ことで、両方を立てる。
  const notes: PendingNote[] = []
  const provided = new Set<string>()
  let noteBytes = 0

  await readZipStream(source, async (entry) => {
    const classified = classifyEntry(entry.path)
    if (classified.kind === 'reject') {
      report.skipped.push({ label: entry.path, reason: classified.reason })
      return
    }
    if (classified.kind === 'attachment') {
      await restoreOne(classified.name, entry.data, provided, report)
      return
    }
    if (classified.kind === 'note') {
      noteBytes += entry.data.byteLength
      if (noteBytes > MAX_ZIP_NOTE_BYTES) {
        // ここだけは ZIP ごと断る。先へ進めても抱える量が増える一方なので、
        // 中途半端に取り込んで力尽きるより、入る形に分けてもらう
        throw new ZipReadError(
          `ノート本文の合計が大きすぎます (上限 ${megabytes(MAX_ZIP_NOTE_BYTES)}MB)。ノートを分けて書き出してから取り込んで下さい`,
        )
      }
      // バイト列のまま抱えず、その場で文字列にする (元は呼び出し元が捨てる)
      notes.push({ path: entry.path, text: DECODER.decode(entry.data) })
    }
  })

  await importNotes(notes, provided, report, options)

  return report
}

interface PendingNote {
  path: string
  text: string
}

// 添付 1 件を保存する。**1 件ずつ順に**呼ばれる (readZipStream が次の項目へ
// 進む前にこれを待つ) ので、載るのは常に 1 件ぶんだけ。
async function restoreOne(
  name: string,
  data: Uint8Array,
  provided: Set<string>,
  report: ZipImportReport,
): Promise<void> {
  try {
    // fflate が返すのは入力バッファへの窓なので、DB へ渡す前に切り離す
    const result = await restoreAttachment(name, ownedBytes(data))
    if (!result.ok) {
      report.skipped.push({ label: `添付 ${name}`, reason: result.reason })
      return
    }
    provided.add(name)
    if (result.created) {
      report.restoredAttachments += 1
      // 画像検索の索引 (embedding) を持ちうるのは画像だけ。音声・PDF・
      // テキスト・動画は元から対象外なので「後回しにした」数に数えない
      if (isValidImageName(name)) {
        report.deferredImageIndex += 1
      }
    }
  } catch (error) {
    // 1 件の失敗で ZIP 全体を落とさない。原因はサーバログに残す
    console.error(`添付を戻せませんでした (${name}):`, error)
    report.skipped.push({ label: `添付 ${name}`, reason: '保存できませんでした' })
  }
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}

async function importNotes(
  notes: PendingNote[],
  provided: Set<string>,
  report: ZipImportReport,
  options: ZipImportOptions,
): Promise<void> {
  // 本文が指しているのに ZIP に入っていない添付。DB に既にあるなら問題ないので、
  // 全ノートを読み終えてから 1 回だけ問い合わせて確かめる
  const referenced = new Set<string>()

  for (const entry of notes) {
    const parsed = parseNoteFile(entry.text)
    if (!parsed.ok) {
      report.skipped.push({ label: entry.path, reason: parsed.reason })
      continue
    }

    try {
      if (!(await writeNote(parsed.note, options))) {
        report.conflictSkipped += 1
        continue
      }
    } catch (error) {
      console.error(`ノートを戻せませんでした (${parsed.note.itemNo}):`, error)
      report.skipped.push({
        label: `${entry.path} (#${parsed.note.itemNo})`,
        reason: error instanceof Error ? error.message : '保存できませんでした',
      })
      continue
    }

    report.imported.push({
      itemNo: parsed.note.itemNo,
      title: firstLine(parsed.note.memo),
    })
    for (const name of collectAttachmentNames(parsed.note.memo)) {
      if (!provided.has(name)) {
        referenced.add(name)
      }
    }
  }

  await reportMissingAttachments(referenced, report)
}

// 書けたら true、既にある番号を見送ったら false。
async function writeNote(
  note: PortableNote,
  options: ZipImportOptions,
): Promise<boolean> {
  // ゴミ箱の行も「使用中の番号」として数える。番号はゴミ箱にある間じゅう
  // 予約されている (docs/12-ゴミ箱計画.md §4) ので、上書きの可否も同じ扱いに
  // しないと、復元したときに中身が入れ替わっている事故になる
  const existing = await prisma.item.findUnique({
    where: { itemNo: note.itemNo },
    select: { itemNo: true },
  })
  if (existing !== null && options.overwrite !== true) {
    return false
  }

  await upsertItem(note.itemNo, {
    memo: note.memo,
    url: note.url,
    mode: note.mode,
  })
  // 書き出した日時をそのまま戻す (ENEX の取り込みと同じ関数)。日時の無い
  // ファイル (手書きの Markdown) は取り込んだ時刻のままになる
  await applyImportedTimestamps(note.itemNo, note.createdAt, note.updatedAt)
  // 公開の状態もファイルに合わせる。setItemPublic は状態が変わるときだけ
  // 書くので、取り込みを繰り返しても公開日時は進まない
  await setItemPublic(note.itemNo, note.isPublic)
  return true
}

// 本文が指しているのに、ZIP にも DB にも無い添付を report に載せる。
//
// **黙っていると画像切れのノートが「取り込めた」ことになる**。ノートを
// 失敗させはしない (本文は正しく入っている) が、何が欠けたかは伝える。
async function reportMissingAttachments(
  referenced: Set<string>,
  report: ZipImportReport,
): Promise<void> {
  if (referenced.size === 0) {
    return
  }
  const names = [...referenced]
  const found = new Set<string>()
  // IN の要素数が青天井にならないよう区切って引く (項目数の上限は 2000)
  const CHUNK = 500
  for (let start = 0; start < names.length; start += CHUNK) {
    const rows = await prisma.image.findMany({
      where: { name: { in: names.slice(start, start + CHUNK) } },
      select: { name: true },
    })
    for (const row of rows) {
      found.add(row.name)
    }
  }

  for (const name of names) {
    if (!found.has(name)) {
      report.skipped.push({
        label: `本文が参照する添付 ${name}`,
        reason: 'ZIP にも DB にも見つかりませんでした (本文の参照はそのまま残しています)',
      })
    }
  }
}

function firstLine(memo: string): string {
  return memo.split('\n', 1)[0] ?? ''
}
