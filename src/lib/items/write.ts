// ノートの本文を書く側の DB 操作 (docs/93-リファクタリング計画.md §4-1)。
// upsert・競合を検査する保存・本文の部分書き換え・取り込んだ日時の反映・
// 画像参照の書き換え。本文を書くたびに派生列を derivedFromMemo で作り直す。
import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import type { Item } from '@/generated/prisma/client'
import { assertDemoItemQuota } from '@/lib/demoQuota'
import { memoSummary } from '@/lib/markdown/memoSummary'
import { replaceImageName } from '@/lib/memoImages'
import { extractProps } from '@/lib/markdown/props'
import { nextVersion, type SaveBase } from '@/lib/saveBase'
import { extractTags } from '@/lib/markdown/tags/tags'
import { countTasks } from '@/lib/markdown/taskCheckbox'
import { itemNoToNum, type Mode } from '@/lib/validation'
import { getItem } from './read'

// Ver1 の /item/:itemNo と同じく、未登録なら新規作成する (upsert)。
// tags / props は memo から抽出した派生キャッシュ (保存のたびに再計算する)。
export async function upsertMemo(itemNo: string, memo: string): Promise<Item> {
  // デモのノート数上限 (docs/39-デモ公開計画.md §2-2)。新規作成になるときだけ
  // 効く (デモでなければ即 return)。既存の更新は数に依らず通す
  await assertDemoItemQuota(itemNo)
  const derived = derivedFromMemo(memo)
  return prisma.item.upsert({
    where: { itemNo },
    update: { memo, ...derived },
    create: { itemNo, itemNoNum: itemNoToNum(itemNo), memo, ...derived },
  })
}

export async function upsertItem(
  itemNo: string,
  data: { memo: string; url: string; mode: Mode },
): Promise<Item> {
  // デモのノート数上限 (docs/39-デモ公開計画.md §2-2)。upsertMemo と同じ門番
  await assertDemoItemQuota(itemNo)
  const derived = derivedFromMemo(data.memo)
  return prisma.item.upsert({
    where: { itemNo },
    update: { ...data, ...derived },
    create: { itemNo, itemNoNum: itemNoToNum(itemNo), ...data, ...derived },
  })
}

// --- 編集の競合 (docs/87-編集競合対策計画.md) ---

// 一意制約違反 (Prisma のエラーコード)。主キー衝突がこれ
const UNIQUE_VIOLATION = 'P2002'

export type SaveOutcome =
  | { ok: true; item: Item }
  // conflict = 別の書き込みが先にあった / exists = 新規のはずが行があった。
  // どちらも**いまの版を返す**ので、画面は差分を見せて選ばせられる
  | { ok: false; reason: 'conflict' | 'exists'; current: Item }
  // 編集中に永久削除された。黙って作り直さない
  | { ok: false; reason: 'missing' }

export interface SaveItemData {
  memo: string
  // 省略した項目は触らない (memo だけ保存する画面がある)
  url?: string
  mode?: Mode
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

// 送られた内容が、いま DB にある内容と同じか。
//
// **行末を揃えてから比べる。** DB には Ver1 由来の CRLF の本文があり、
// エディタはそれを LF に正規化して送る (MemoEditor の initialValue)。
// 素で比べると「何も変えていないのに競合」を作ってしまう
function sameContent(current: Item, data: SaveItemData): boolean {
  return (
    normalizeNewlines(current.memo) === normalizeNewlines(data.memo) &&
    (data.url === undefined || current.url === data.url) &&
    (data.mode === undefined || current.mode === data.mode)
  )
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  )
}

// 「画面が見ていた版のままなら書く」保存 (docs/87 §2-4)。
//
// 要点は **where に基点を入れた 1 文**であること。読んで比べて書くのでは
// 検査と書き込みの間に隙間ができ、そこに別の端末の保存が滑り込む。
//
// updated_at は @updatedAt に任せず nextVersion で明示的に打つ。同じ
// ミリ秒に 2 回書くと版が重なり、その隙間で読んだ基点が 2 回目の書き込みを
// 素通りしてしまう (ABA)。Prisma 7.9.1 は data に明示した値が @updatedAt に
// 勝つ (実測済み)。
//
// upsertMemo / upsertItem は残してある — インポート・履歴からの復元が使う
// 「明示的な上書き」の口。**画面からの保存はこちらを通す**
export async function saveItemIfUnchanged(
  itemNo: string,
  data: SaveItemData,
  base: SaveBase,
): Promise<SaveOutcome> {
  const derived = derivedFromMemo(data.memo)

  if (base.kind === 'new') {
    // デモのノート数上限 (docs/39 §2-2)。新規作成のときだけ効く門番で、
    // upsert 時代と同じ効き方 (既存の更新は数に依らず通す)
    await assertDemoItemQuota(itemNo)
    try {
      const item = await prisma.item.create({
        data: { itemNo, itemNoNum: itemNoToNum(itemNo), ...data, ...derived },
      })
      return { ok: true, item }
    } catch (error) {
      // 2 台で同時に「+」を押すと同じ番号が採番されうる (nextItemNo は
      // 予約しない)。upsert のままだと後から保存した側が先のノートを
      // 丸ごと潰すので、ここで止める
      if (isUniqueViolation(error)) {
        const current = await getItem(itemNo)
        if (current !== null) {
          return { ok: false, reason: 'exists', current }
        }
      }
      throw error
    }
  }

  // 基点が判らない本文 (旧形式の下書きから復元した本文)。いまの版を当てず、
  // 必ず競合として見せる (docs/87 §2-6)
  if (base.kind === 'stale') {
    const current = await getItem(itemNo)
    return current === null
      ? { ok: false, reason: 'missing' }
      : { ok: false, reason: 'conflict', current }
  }

  const rows = await prisma.item.updateManyAndReturn({
    where: { itemNo, updatedAt: base.at },
    data: { ...data, ...derived, updatedAt: nextVersion(base.at) },
  })
  const saved = rows[0]
  if (saved !== undefined) {
    return { ok: true, item: saved }
  }

  const current = await getItem(itemNo)
  if (current === null) {
    return { ok: false, reason: 'missing' }
  }
  // 二重送信や、別タブが同じ内容を先に保存した場合。書かずに成功扱いにする
  // (版を動かさない = 開いている他の画面の基点を無効にしない)
  if (sameContent(current, data)) {
    return { ok: true, item: current }
  }
  return { ok: false, reason: 'conflict', current }
}

export type ModifyOutcome = 'saved' | 'unchanged' | 'rejected' | 'missing'

export interface ModifyMemoOptions {
  // 読み直した本文に同じ書き換えを当て直してよいかを見る門番。
  // **行番号で対象を指す書き換え (チェックの切り替え) だけが要る** —
  // 行が増減していると、ずれた先が偶然タスク行だったときに別の項目を
  // 裏返してしまう。本文で位置が決まる書き換え (タグ・健康記録) は
  // 何度当て直しても同じ場所に着くので、渡さなくてよい
  canRetry?: (first: string, current: string) => boolean
  attempts?: number
}

// 本文の一部だけを書き換える (チェック・健康記録・一括タグ)。
//
// 「読む → 変換 → CAS、負けたら読み直して当て直す」。送られてくるのは
// **望む状態**であって「裏返せ」ではないので、当て直しても意図とずれない
// (toggleMemoTaskAction の約束そのもの)。
//
// transform が Promise を返してもよいのは、書き換えの途中で外を引く余地を
// 残すため (テストは読みと書きの間に別の保存を割り込ませるのに使う)
export async function modifyMemo(
  itemNo: string,
  transform: (memo: string) => string | null | Promise<string | null>,
  options: ModifyMemoOptions = {},
): Promise<ModifyOutcome> {
  const { canRetry, attempts = 3 } = options
  let first: string | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    const item = await getItem(itemNo)
    if (item === null) {
      return 'missing'
    }
    if (first === null) {
      first = item.memo
    } else if (canRetry !== undefined && !canRetry(first, item.memo)) {
      return 'rejected'
    }

    const next = await transform(item.memo)
    // この本文には当てられない (行番号が古い = 本文が変わった印)
    if (next === null) {
      return 'rejected'
    }
    // 既に望む状態。書かない = 版を動かさない
    if (next === item.memo) {
      return 'unchanged'
    }

    const rows = await prisma.item.updateManyAndReturn({
      where: { itemNo, updatedAt: item.updatedAt },
      data: {
        memo: next,
        ...derivedFromMemo(next),
        updatedAt: nextVersion(item.updatedAt),
      },
    })
    if (rows.length === 1) {
      return 'saved'
    }
  }

  // 単独ユーザーでここまで負け続けるのは異常。黙って諦めず知らせる
  throw new Error('本文の更新が競合しました。もう一度お試しください')
}

// 取り込んだノートの作成・更新日時を、元のファイルが持っていた値に戻す
// (ENEX インポート = docs/28 §4 / ZIP インポート = 同 §3)。
//
// Prisma の update は @updatedAt を必ず「いま」で打ってしまうので生 SQL で書く
// (setItemPublic / trashItems と同じ理由)。これをしないと取り込んだ全ノートが
// 同じ時刻に並び、更新順の一覧が意味をなさなくなる。
//
// **accessed_at は触らない** (docs/37-アクセス順計画.md §5)。列の既定値
// (now()) のまま = 取り込んだ時刻が入る。これで取り込んだノートが
// 「アクセス順」の先頭に並び、古い日時 (Evernote 由来の 2012 年など) で
// 埋もれずに済む — インポートの目的そのもの。
//
// どちらか片方しか無いときはもう片方で埋める。両方無ければ何もしない
// (取り込んだ時刻のまま = upsert が入れた値)。
export async function applyImportedTimestamps(
  itemNo: string,
  createdAt: Date | null,
  updatedAt: Date | null,
): Promise<void> {
  const created = createdAt ?? updatedAt
  const updated = updatedAt ?? createdAt
  if (created === null || updated === null) {
    return
  }
  await prisma.$executeRaw`
    UPDATE items SET created_at = ${created}, updated_at = ${updated}
    WHERE item_no = ${itemNo}
  `
}

// 本文に貼った画像を回転したとき、旧 URL を新 URL に書き換える
// (docs/49-画像回転計画.md §3)。回転は画像を新 UUID で保存し直すため、その名前を
// 参照している本文をすべて追随させる。返り値は書き換えたノート数。
//
// **ゴミ箱の行も含めて**全件を対象にする — deleted_at で絞らない。復元したときに
// 旧 URL のまま画像切れになるのを避ける。1 枚の画像を複数ノートが参照していても
// (docs/20 §1) すべて揃って新しい向きになる。
//
// 対象探しは `position(name IN memo) > 0`。**LIKE は使わない** — PGroonga が
// LIKE を全文一致に乗っ取るため、部分一致は position() で見る
// (isPublicImageName と同じ流儀)。派生列 (tags/props) も再計算に乗せる
// (upsertMemo と同じ)。競合を避けるためトランザクションで囲む。
export async function rewriteImageReference(
  oldName: string,
  newName: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ item_no: string; memo: string }[]>`
    SELECT item_no, memo FROM items
    WHERE position(${oldName} IN memo) > 0
  `
  if (rows.length === 0) {
    return 0
  }
  await prisma.$transaction(
    rows.map((row) => {
      const memo = replaceImageName(row.memo, oldName, newName)
      return prisma.item.update({
        where: { itemNo: row.item_no },
        data: { memo, ...derivedFromMemo(memo) },
      })
    }),
  )
  return rows.length
}

// memo 由来の派生キャッシュ列。正本は memo なので保存のたびに丸ごと作り直す。
// 書き込み経路 (upsertMemo / upsertItem) を 1 箇所に集約して、再計算漏れを防ぐ。
function derivedFromMemo(memo: string) {
  const tasks = countTasks(memo)
  return {
    // 一覧の見出し。並べ替え専用の列で、表示は今までどおり ItemRow が
    // memoSummary() をその場で通す (docs/63-タイトル順計画.md §3)
    title: memoSummary(memo),
    tags: extractTags(memo),
    props: extractProps(memo),
    taskTodo: tasks.todo,
    taskDone: tasks.done,
  }
}
