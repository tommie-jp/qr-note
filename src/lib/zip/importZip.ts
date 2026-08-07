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
import { isAlreadyImported } from '@/lib/importDuplicate'
import type { BaseImportReport } from '@/lib/importReport'
import {
  applyImportedTimestamps,
  nextItemNo,
  setItemPublic,
  upsertItem,
} from '@/lib/items'
import { isValidImageName } from '@/lib/uploads'
import { itemNoToNum } from '@/lib/validation'
import type { ConflictPolicy } from './conflictPolicy'
import { classifyEntry } from './layout'
import { MAX_ZIP_NOTE_BYTES } from './limits'
import { collectAttachmentNames, parseNoteFile, type PortableNote } from './noteFile'
import { readZipStream, ZipReadError } from './readZip'

// 本文は UTF-8 で書き出している (buildNoteFile)。使い回してよい
const DECODER = new TextDecoder()

export interface ZipImportOptions {
  // 同じ番号のノートが既にあるときどうするか (既定: skip = そのまま残す)。
  //
  // 既定を「見送る」にしてあるのは §5 の判断 — 戻す操作で手元の編集を黙って
  // 潰すほうが取り返しがつかない。上書き・番号の振り直しは利用者が明示的に
  // 選んだときだけ。
  conflict?: ConflictPolicy

  // ノートの反映が始まったとき・1 件進んだときの知らせ
  // (docs/28-エクスポート計画.md §9)。**取り込みの成否には関わらない**ので、
  // 渡さなくても動く。添付の進み具合は読んだバイト数として route 側が数える
  // (この関数はバイトを読む前の入口を持っていない)
  onNotesStart?: (total: number) => void
  onNoteDone?: () => void
}

export interface ZipImportReport extends BaseImportReport {
  // 既にある番号を上書きせずに見送った数。skipped とは分けて数える —
  // 「失敗して入らなかった」ではなく「あえて入れなかった」で、
  // 既定のポリシーどおりに動いた正常な結果だから
  conflictSkipped: number
  // 番号が衝突したが、**同じ内容のノートが既にいた**ので採番せず見送った数
  // (renumber のときだけ増える)。名前も意味も ENEX と同じ — 再実行の正常な
  // 結果で、これが多い = 冪等に効いている
  duplicateSkipped: number
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
    duplicateSkipped: 0,
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
  // 「そもそもこのアプリの ZIP か」を判じるための数え (下の assertOurZip)
  const seen = { entries: 0, usable: 0, meta: false }

  await readZipStream(
    source,
    async (entry) => {
      // ここへ来るのは accept が通した項目だけ (note か attachment)
      const classified = classifyEntry(entry.path)
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
    },
    {
      // **展開する前に振り分ける** (docs/28 §3)。取り込まない項目は
      // readZipStream 側で捨てられ、1 項目の大きさの門にも掛からない —
      // 関係のない ZIP の中の大きなファイルを、こちらの器の都合で
      // 「大きすぎます」と断らないため
      accept: (path) => {
        seen.entries += 1
        const classified = classifyEntry(path)
        if (classified.kind === 'reject') {
          report.skipped.push({ label: path, reason: classified.reason })
          return false
        }
        if (classified.kind === 'meta') {
          seen.meta = true
          return false
        }
        if (classified.kind === 'skip') {
          return false
        }
        seen.usable += 1
        return true
      },
    },
  )

  assertOurZip(seen)

  await importNotes(notes, provided, report, options)

  return report
}

// このアプリの ZIP でなければ、**1 行で断る**。
//
// 別物の ZIP (アプリの配布物・写真のまとめなど) を選ぶことは実際に起きる。
// 何も言わずに取り込むと「成功 0 件 / 見送り 257 件」という読めない羅列に
// なり、利用者は「壊れているのか、選び間違えたのか」を判断できない。
//
// **項目が 1 つも無い ZIP は断らない** (空を取り込んで「0 件でした」と言うのは
// 正しい)。export.json があるものも断らない — 0 件のときの書き出しがこの形で、
// 中身が空なのと選び間違えたのとは別の話だから。
function assertOurZip(seen: { entries: number; usable: number; meta: boolean }): void {
  if (seen.usable > 0 || seen.meta || seen.entries === 0) {
    return
  }
  throw new ZipReadError(
    'このアプリが書き出した ZIP ではないようです (notes/ の Markdown も images/ の添付も入っていません)。エクスポートで書き出した .zip を選んで下さい',
  )
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

  const conflict = options.conflict ?? 'skip'
  // 採番から外す番号 (renumber のときだけ要る)。ここでもう一度読み直すのは、
  // 解釈した結果を全件抱えると本文の複製をメモリに載せることになるため
  // (抱えてよいのは番号だけ)
  const reservedNos = conflict === 'renumber' ? reservedItemNoNums(notes) : []

  options.onNotesStart?.(notes.length)

  for (const entry of notes) {
    // **見送ったものも 1 件進んだこと**にする。分母は notes.length なので、
    // 読めないファイルを数えないと最後まで到達しない
    const parsed = parseNoteFile(entry.text)
    if (!parsed.ok) {
      report.skipped.push({ label: entry.path, reason: parsed.reason })
      options.onNoteDone?.()
      continue
    }

    let outcome: WriteOutcome
    try {
      outcome = await writeNote(parsed.note, conflict, reservedNos)
    } catch (error) {
      console.error(`ノートを戻せませんでした (${parsed.note.itemNo}):`, error)
      report.skipped.push({
        label: `${entry.path} (#${parsed.note.itemNo})`,
        reason: error instanceof Error ? error.message : '保存できませんでした',
      })
      continue
    } finally {
      options.onNoteDone?.()
    }

    if (outcome.kind === 'conflict') {
      report.conflictSkipped += 1
      continue
    }
    if (outcome.kind === 'duplicate') {
      report.duplicateSkipped += 1
      continue
    }

    report.imported.push({
      itemNo: outcome.itemNo,
      title: firstLine(parsed.note.memo),
      // 振り直したときだけ載せる (JSON に undefined は出ない)
      ...(outcome.renumberedFrom === null
        ? {}
        : { renumberedFrom: outcome.renumberedFrom }),
    })
    for (const name of collectAttachmentNames(parsed.note.memo)) {
      if (!provided.has(name)) {
        referenced.add(name)
      }
    }
  }

  await reportMissingAttachments(referenced, report)
}

// ZIP 側のノートが使う番号 (item_no_num にできるものだけ)。
//
// **まだ書いていないノートの番号も含めて**採番から外すために集める。空き番号が
// たまたま ZIP の別ノートの番号だと、それを横取りして「衝突していないノートは
// 元の番号のまま」という約束が崩れる。読めないファイルは番号が判らないので
// 外れるが、そのファイルはどのみち取り込まれない。
function reservedItemNoNums(notes: PendingNote[]): number[] {
  const nums: number[] = []
  for (const entry of notes) {
    const parsed = parseNoteFile(entry.text)
    if (!parsed.ok) {
      continue
    }
    const num = itemNoToNum(parsed.note.itemNo)
    if (num !== null) {
      nums.push(num)
    }
  }
  return nums
}

type WriteOutcome =
  // 入れた。renumberedFrom は振り直したときの元の番号 (振っていなければ null)
  | { kind: 'written'; itemNo: string; renumberedFrom: string | null }
  // 番号が衝突したので見送った (skip)
  | { kind: 'conflict' }
  // 番号は衝突したが、同じ内容のノートが既にいたので見送った (renumber)
  | { kind: 'duplicate' }

// ノート 1 件を入れる。「見送る」は例外ではなく戻り値で返す (呼ぶ側が数える)。
async function writeNote(
  note: PortableNote,
  conflict: ConflictPolicy,
  reservedNos: readonly number[],
): Promise<WriteOutcome> {
  // ゴミ箱の行も「使用中の番号」として数える。番号はゴミ箱にある間じゅう
  // 予約されている (docs/12-ゴミ箱計画.md §4) ので、衝突の可否も同じ扱いに
  // しないと、復元したときに中身が入れ替わっている事故になる
  const existing = await prisma.item.findUnique({
    where: { itemNo: note.itemNo },
    select: { itemNo: true },
  })

  let itemNo = note.itemNo
  let renumberedFrom: string | null = null
  if (existing !== null) {
    if (conflict === 'skip') {
      return { kind: 'conflict' }
    }
    if (conflict === 'renumber') {
      // **再実行で増やさない** (docs/28 §5)。同じ ZIP を 2 回流すと毎回衝突
      // するので、素朴に採番すると全ノートが複製される。同内容のノートが
      // 既にいるなら、それは取り込み済みということなので見送る
      const created = note.createdAt ?? note.updatedAt
      if (await isAlreadyImported(created, firstLine(note.memo))) {
        return { kind: 'duplicate' }
      }
      // 採番は ENEX と同じ nextItemNo (空き番号の最小値)。ノートのループは
      // 直列なので採番の競合はない
      itemNo = await nextItemNo(reservedNos)
      renumberedFrom = note.itemNo
    }
  }

  // 本文は書き換えない。本文中の /item/<番号> は「取り込み先に元からある
  // ノート」を指す意図かもしれず、書き換えは当て推量になる (§5)
  await upsertItem(itemNo, {
    memo: note.memo,
    url: note.url,
    mode: note.mode,
  })
  // 書き出した日時をそのまま戻す (ENEX の取り込みと同じ関数)。日時の無い
  // ファイル (手書きの Markdown) は取り込んだ時刻のままになる
  await applyImportedTimestamps(itemNo, note.createdAt, note.updatedAt)
  // 公開の状態もファイルに合わせる。setItemPublic は状態が変わるときだけ
  // 書くので、取り込みを繰り返しても公開日時は進まない
  await setItemPublic(itemNo, note.isPublic)
  return { kind: 'written', itemNo, renumberedFrom }
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
