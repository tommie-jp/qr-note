// ノート 1 件を書き換える本体 (docs/123 §2-1)。もとは app/actions/items.ts・
// publish.ts・number.ts にあった Server Action の中身で、門番 (ログイン・デモ)
// と入力の形の検査は呼ぶ側の route が済ませてから来る。
//
// 書き終えたノートを返す。端末はそれで控えを差し替える (取り直さずに済む)
import 'server-only'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import type { Item } from '@/generated/prisma/client'
import { renderCircuits } from '@/lib/circuit/cache'
import type { SaveBase } from '@/lib/editor/saveBase'
import { noteSnapshot, type SaveState } from '@/lib/editor/saveState'
import { recordMeasurement } from '@/lib/health/healthEdit'
import { recordItemAccess, setItemPublic } from '@/lib/items/flags'
import { hasNoteNumber } from '@/lib/items/noteNumber'
import { nextFreeNoteNumber } from '@/lib/items/noteNumber.server'
import { getItem } from '@/lib/items/read'
import { modifyMemo, saveItemIfUnchanged } from '@/lib/items/write'
import { differsOnlyInTaskMarks, toggleTaskLine } from '@/lib/markdown/taskCheckbox'
import { addTagToMemo } from '@/lib/markdown/tags/edit'
import { extractTags } from '@/lib/markdown/tags/tags'
import { MAX_TEXT_LENGTH } from '@/lib/validation'
import { checkpointBeforeOverwrite } from './checkpoint'
import { CommandError } from './commandError'

// 公開ノートはサーバ描画 (PublicItemView) のまま残る (docs/123 §4-5)。
// 書いたら、その画面だけは描き直させる
function revalidatePublicView(itemId: string): void {
  revalidatePath(`/item/${itemId}`)
}

// 保存したノートの回路図を応答の後に描いておく (docs/85 §4)。
// 失敗しても保存は成功のまま — 図は派生データでしかない
function warmCircuitsAfterResponse(itemId: string, memo: string): void {
  after(async () => {
    try {
      await renderCircuits(memo)
    } catch (error) {
      console.warn(`保存後の回路図を描けませんでした (${itemId})`, error)
    }
  })
}

async function reloadItem(itemId: string): Promise<Item> {
  const item = await getItem(itemId)
  if (item === null) {
    throw new CommandError(404, 'ノートが見つかりません')
  }
  return item
}

function conflict(kind: NonNullable<SaveState>['kind'], current: Item | null): SaveState {
  return {
    seq: Date.now(),
    kind,
    server: current === null ? null : noteSnapshot(current),
  }
}

export type SaveNoteResult =
  | { readonly ok: true; readonly item: Item }
  | { readonly ok: false; readonly state: SaveState }

// 本文の保存。**画面が見ていた版のままなら書く** (docs/87 §2-4)。
// 食い違っていたら書かずに競合を返す — 端末はバナーで差分を見せる
export async function saveNote(
  itemId: string,
  memo: string,
  base: SaveBase,
  checkpoint: boolean,
): Promise<SaveNoteResult> {
  // 「このまま上書き」を選んだ送信だけが立てる印。消える版を先に刻む
  if (checkpoint && !(await checkpointBeforeOverwrite(itemId, memo))) {
    return { ok: false, state: conflict('checkpointFailed', await getItem(itemId)) }
  }
  const result = await saveItemIfUnchanged(itemId, { memo }, base)
  if (!result.ok) {
    return {
      ok: false,
      state: conflict(result.reason, result.reason === 'missing' ? null : result.current),
    }
  }
  warmCircuitsAfterResponse(itemId, memo)
  revalidatePublicView(itemId)
  return { ok: true, item: result.item }
}

// タスクリストのチェックを切り替える (docs/55 §4)。送るのは望む状態。
// 行番号で対象を指すので、行がずれていたら当て直さない (docs/87 §2-5)
export async function toggleTask(itemId: string, line: number, checked: boolean): Promise<Item> {
  const result = await modifyMemo(itemId, (memo) => toggleTaskLine(memo, line, checked), {
    canRetry: differsOnlyInTaskMarks,
  })
  if (result === 'missing') {
    throw new CommandError(404, 'ノートが見つかりません')
  }
  if (result === 'rejected') {
    throw new CommandError(409, '本文が変わっています。画面を更新してください')
  }
  revalidatePublicView(itemId)
  return reloadItem(itemId)
}

export interface HealthRecord {
  date: string
  item: string
  values: number[]
  unit: string
}

// 健康記録を 1 つ書き込む (docs/83 §7)。書いた行を読み直せることが合格条件
export async function recordHealth(itemId: string, record: HealthRecord): Promise<Item> {
  const result = await modifyMemo(itemId, (memo) => {
    const next = recordMeasurement(memo, record)
    if (next === null) {
      return null
    }
    // 本文が伸びる経路なので長さも検める (フォームの readText を通らない)
    if (next.length > MAX_TEXT_LENGTH) {
      throw new CommandError(400, `本文が長すぎます (最大 ${MAX_TEXT_LENGTH} 文字)`)
    }
    return next
  })
  if (result === 'missing') {
    throw new CommandError(404, 'ノートが見つかりません')
  }
  if (result === 'rejected') {
    throw new CommandError(400, 'この値は記録できません')
  }
  revalidatePublicView(itemId)
  return reloadItem(itemId)
}

// 開いたことを記録する (docs/37)。失敗しても投げない — 並びが 1 回進まない
// だけで、ノートの表示を巻き添えにする理由がない
export async function recordAccess(itemId: string): Promise<void> {
  try {
    await recordItemAccess(itemId)
  } catch (error) {
    console.error(`アクセス日時を記録できませんでした (${itemId}):`, error)
  }
}

// 番号を振る (docs/111 §6)。既に番号があれば何もしない
export async function assignNoteNumber(itemId: string): Promise<Item> {
  const item = await reloadItem(itemId)
  if (hasNoteNumber(item.tags)) {
    return item
  }
  const noteNumber = await nextFreeNoteNumber()
  if (noteNumber === null) {
    throw new CommandError(409, '空き番号がありません (1000〜9999)')
  }
  const result = await modifyMemo(itemId, (memo) =>
    hasNoteNumber(extractTags(memo)) ? memo : addTagToMemo(memo, noteNumber),
  )
  if (result === 'missing') {
    throw new CommandError(404, 'ノートが見つかりません')
  }
  revalidatePublicView(itemId)
  return reloadItem(itemId)
}

// 公開・非公開 (docs/22)。望む状態を受け取る (連打で逆に倒れない)
export async function setNotePublic(itemId: string, isPublic: boolean): Promise<Item> {
  await setItemPublic(itemId, isPublic)
  revalidatePublicView(itemId)
  return reloadItem(itemId)
}
