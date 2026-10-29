// 端末側の action (docs/123 §2-1)。
//
// **Server Action と同じ形 (引数と戻り値) にしてある。** 部品は今までどおり
// `<form action={…}>` や useActionState に渡すだけで、中身が Server Action から
// JSON API の呼び出しに替わる。部品の props を書き換えずに済み、Server Action
// を消しても部品は動く。
//
// どれも書いた後に控えを古くする (invalidate.ts)。サーバ描画のまま残る画面
// (ゴミ箱・履歴) は refreshServerView で描き直させる
import 'client-only'
import { isItemDto, type ItemDto } from '@/lib/api/itemDto'
import type { SaveState } from '@/lib/editor/saveState'
import { switchPaneMode } from '@/components/panes/switchPaneMode'
import { switchViewMode } from '@/components/search/switchViewMode'
import { PANE_MODE_COOKIE, parsePaneMode } from '@/lib/prefs/paneMode'
import { parseViewMode, VIEW_MODE_COOKIE } from '@/lib/prefs/viewMode'
import { buildSearchUrl, buildTrashUrl } from '@/lib/search/url'
import { parseSort, parseTrashSort } from '@/lib/validation'
import type { BenchStatus } from '@/lib/diag/benchStatus'
import { ApiError, apiGet, apiSend } from './api'
import { allNotesWritten, noteWritten, notesWritten } from './invalidate'
import { navigate, refreshServerView } from './navigation'
import { searchSortStore } from './searchPrefs'

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function formItemIds(formData: FormData): string[] {
  return formData.getAll('itemId').filter((v): v is string => typeof v === 'string')
}

function itemPath(itemId: string, suffix = ''): string {
  return `/api/items/${encodeURIComponent(itemId)}${suffix}`
}

// 応答のノートを取り出す。形が違えば控えを古くするだけにする
function itemOf(data: unknown): ItemDto | undefined {
  const item = (data as { item?: unknown } | null)?.item
  return isItemDto(item) ? item : undefined
}

// 保存後の「保存しました」トースト用の戻り先 (docs/11 §2-3)
export function savedHref(itemId: string): string {
  return `/item/${itemId}?saved=${Date.now()}`
}

function isSaveState(value: unknown): value is NonNullable<SaveState> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    ['conflict', 'exists', 'missing', 'checkpointFailed'].includes(v.kind as string) &&
    typeof v.seq === 'number'
  )
}

// 本文の保存 (閲覧画面の編集タブと /edit の両方)。競合は戻り値で返し、
// エディタの本文はそのままにバナーを出す (docs/87 §2-4)
export async function updateMemoAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  return saveWithConflict(formData)
}

export async function updateItemAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  return saveWithConflict(formData)
}

// 409 の本文 (いまのサーバの版) を読むため、ここだけ fetch を直に使う
async function saveWithConflict(formData: FormData): Promise<SaveState> {
  const itemId = formString(formData, 'itemId')
  const response = await fetch(itemPath(itemId), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      memo: formString(formData, 'memo'),
      base: formString(formData, 'base'),
      checkpoint: formData.get('checkpoint') === '1',
    }),
  }).catch(() => {
    throw new ApiError(0, '通信できませんでした。電波の届く所でもう一度お試しください')
  })
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { data?: { state?: unknown } } | null
    const state = body?.data?.state
    noteWritten(itemId)
    if (isSaveState(state)) {
      return state
    }
    throw new ApiError(409, 'ほかの画面で書き換えられています')
  }
  if (response.status === 401) {
    window.location.reload()
    throw new ApiError(401, 'ログインが必要です')
  }
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: unknown; error?: unknown }
    | null
  if (!response.ok || body?.success !== true) {
    const message = typeof body?.error === 'string' ? body.error : `保存できませんでした (${response.status})`
    throw new ApiError(response.status, message)
  }
  noteWritten(itemId, itemOf(body.data))
  navigate(savedHref(itemId))
  return null
}

// 閲覧画面のタスクのチェック (docs/55 §4)。送るのは望む状態
export async function toggleMemoTaskAction(
  itemId: string,
  line: number,
  checked: boolean,
): Promise<void> {
  const { data } = await apiSend('PATCH', itemPath(itemId, '/tasks'), { line, checked })
  noteWritten(itemId, itemOf(data))
}

// 閲覧画面の記録欄から健康記録を 1 つ (docs/83 §7)
export async function recordHealthAction(
  itemId: string,
  date: string,
  item: string,
  values: number[],
  unit: string,
): Promise<void> {
  const { data } = await apiSend('POST', itemPath(itemId, '/health'), { date, item, values, unit })
  noteWritten(itemId, itemOf(data))
}

// 開いたことの記録 (docs/37)。**画面を開いた副作用**なので失敗しても黙る。
// 401 でも画面を読み直さない (apiSend を通さない)
export async function recordAccessAction(itemId: string): Promise<void> {
  try {
    await fetch(itemPath(itemId, '/access'), { method: 'POST', credentials: 'same-origin' })
  } catch (error) {
    console.warn(`開いた記録を送れませんでした (${itemId})`, error)
  }
}

export async function setItemPublicAction(formData: FormData): Promise<void> {
  const itemId = formString(formData, 'itemId')
  const { data } = await apiSend('PUT', itemPath(itemId, '/public'), {
    isPublic: formData.get('public') === '1',
  })
  noteWritten(itemId, itemOf(data))
}

export async function assignNoteNumberAction(formData: FormData): Promise<void> {
  const itemId = formString(formData, 'itemId')
  const { data } = await apiSend('POST', itemPath(itemId, '/number'))
  noteWritten(itemId, itemOf(data))
}

export async function setItemOfflinePinAction(formData: FormData): Promise<void> {
  const itemId = formString(formData, 'itemId')
  await apiSend('PUT', '/api/items/pin', {
    itemIds: [itemId],
    pinned: formData.get('pin') === '1',
  })
  notesWritten([itemId])
}

export async function setItemsOfflinePinAction(formData: FormData): Promise<void> {
  const itemIds = formItemIds(formData)
  await apiSend('PUT', '/api/items/pin', { itemIds, pinned: true })
  notesWritten(itemIds)
}

// 一括タグ (選択モードの「追加」と、タグの × による「外す」)
export async function bulkTagAction(formData: FormData): Promise<void> {
  const itemIds = formItemIds(formData)
  const removeTag = formString(formData, 'removeTag')
  const isRemove = removeTag.length > 0
  await apiSend('POST', '/api/items/tags', {
    mode: isRemove ? 'remove' : 'add',
    itemIds,
    tags: isRemove ? removeTag : formString(formData, 'addTags'),
  })
  notesWritten(itemIds)
}

async function trashOp(op: 'trash' | 'restore' | 'purge' | 'empty', itemIds: string[]): Promise<void> {
  await apiSend('POST', '/api/trash', { op, itemIds })
  // 空にするときは消えたノートの id が手元に無い。全部を古くする
  if (op === 'empty') {
    allNotesWritten()
  } else {
    notesWritten(itemIds)
  }
  refreshServerView()
}

export async function trashItemsAction(formData: FormData): Promise<void> {
  await trashOp('trash', formItemIds(formData))
}

export async function restoreItemsAction(formData: FormData): Promise<void> {
  await trashOp('restore', formItemIds(formData))
}

export async function purgeItemsAction(formData: FormData): Promise<void> {
  await trashOp('purge', formItemIds(formData))
}

export async function emptyTrashAction(): Promise<void> {
  await trashOp('empty', [])
}

// 表示モードとペイン構成。押した瞬間に描き替える仕組み (switchViewMode・
// switchPaneMode) に渡す。検索のツールバーとヘッダーのボタンは submit を
// 拾って先に呼ぶので、ここへ来るのはそれ以外 (ゴミ箱の操作バー) だけ
export async function setViewModeAction(formData: FormData): Promise<void> {
  await switchViewMode(parseViewMode(formData.get(VIEW_MODE_COOKIE)), refreshServerView)
}

export async function setPaneModeAction(formData: FormData): Promise<void> {
  await switchPaneMode(parsePaneMode(formData.get(PANE_MODE_COOKIE)), refreshServerView)
}

export async function setSortAction(formData: FormData): Promise<void> {
  const sort = parseSort(formData.get('sort'))
  await apiSend('PUT', '/api/settings/sort', { sort, scope: 'search' })
  searchSortStore.set(sort)
  navigate(buildSearchUrl(formString(formData, 'q'), 1, sort), { replace: true })
}

export async function setTrashSortAction(formData: FormData): Promise<void> {
  const sort = parseTrashSort(formData.get('trashSort'))
  await apiSend('PUT', '/api/settings/sort', { sort, scope: 'trash' })
  navigate(buildTrashUrl(sort), { replace: true })
}

export async function commitNoteAction(formData: FormData): Promise<void> {
  const itemId = formString(formData, 'itemId')
  const { data } = await apiSend<{ result?: string }>('POST', itemPath(itemId, '/history'), {
    op: 'commit',
    message: formString(formData, 'message'),
  })
  const done = data?.result === 'committed' ? 'committed' : 'noop'
  navigate(`/item/${itemId}/history?done=${done}`)
  refreshServerView()
}

export async function restoreNoteVersionAction(formData: FormData): Promise<void> {
  const itemId = formString(formData, 'itemId')
  const { data } = await apiSend('POST', itemPath(itemId, '/history'), {
    op: 'restore',
    oid: formString(formData, 'oid'),
  })
  noteWritten(itemId, itemOf(data))
  navigate(savedHref(itemId))
}

export async function backfillHistoryAction(): Promise<void> {
  const { data } = await apiSend<{ result?: string }>('POST', '/api/history/backfill')
  const done = data?.result === 'imported' ? 'imported' : 'noop'
  navigate(`/settings/history?done=${done}`)
  refreshServerView()
}

// ベンチマーク (docs/121)。管理者だけ。状態の形は画面が描くだけなので
// オブジェクトであることだけ確かめる
function benchStatusOf(data: unknown): BenchStatus {
  if (typeof data !== 'object' || data === null) {
    throw new ApiError(500, 'ベンチマークの状態の形が違います')
  }
  return data as BenchStatus
}

export async function getBenchStatusAction(): Promise<BenchStatus> {
  const { data } = await apiGet<unknown>('/api/diag/bench')
  return benchStatusOf(data)
}

export async function startCpuBenchAction(): Promise<BenchStatus> {
  const { data } = await apiSend<unknown>('POST', '/api/diag/bench', { kind: 'cpu' })
  return benchStatusOf(data)
}

export async function startServerBenchAction(): Promise<BenchStatus> {
  const { data } = await apiSend<unknown>('POST', '/api/diag/bench', { kind: 'server' })
  return benchStatusOf(data)
}
