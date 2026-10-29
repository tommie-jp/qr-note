// 書き込みの後にどの控えを古くするか (docs/123 §3-3)。
//
// 「一覧は全部古くする」で足りる。検索の結果は数百件で、取り直しは 1 往復。
// 古い印を付けるだけで消さないので、取り直しの間も前の一覧が残る
import 'client-only'
import { reviveItem, type ItemDto } from '@/lib/api/itemDto'
import { foldersCache, listCache, tagsCache, trashCache } from './listStore'
import { circuitsCache, neighborsCache, noteCache, renderCache } from './noteStore'

function invalidateLists(): void {
  listCache.invalidate()
  trashCache.invalidate()
  neighborsCache.invalidate()
  tagsCache.invalidate()
  foldersCache.invalidate()
}

// 1 件のノートを書いた後。応答でノートが届いていれば控えを差し替える
export function noteWritten(itemId: string, dto?: ItemDto | null): void {
  if (dto === undefined) {
    noteCache.invalidate((id) => id === itemId)
  } else {
    noteCache.set(itemId, { item: dto === null ? null : reviveItem(dto) })
  }
  circuitsCache.invalidate((id) => id === itemId)
  // 他のノートの表・グラフ (```matrix・```health) はこのノートを数えているかも
  // しれない。どれが数えているかは端末では分からないので、全部古くする
  renderCache.invalidate()
  invalidateLists()
}

// 複数のノートを書いた後 (ゴミ箱・一括タグ・オフラインの印)
export function notesWritten(itemIds: readonly string[]): void {
  const ids = new Set(itemIds)
  noteCache.invalidate((id) => ids.has(id))
  renderCache.invalidate()
  circuitsCache.invalidate((id) => ids.has(id))
  invalidateLists()
}

// どのノートが変わったか分からない書き込み (ゴミ箱を空にする)
export function allNotesWritten(): void {
  noteCache.invalidate()
  renderCache.invalidate()
  circuitsCache.invalidate()
  invalidateLists()
}

// 同期で新しい写しが届いたとき (docs/123 §5)。**写しと版が違うノートだけ**
// 古くする。全部を古くすると、開いている画面が一斉に取り直す (自分の保存の
// 後の同期でも毎回起きる)。一覧は写しと比べようがないので古くする
export function snapshotChanged(updatedAtById: ReadonlyMap<string, string>): void {
  noteCache.invalidate((id) => {
    const cached = noteCache.peek(id)?.value?.item
    if (cached === undefined) {
      return false
    }
    const synced = updatedAtById.get(id)
    // 写しに無い (消えた・ゴミ箱) か、版が違う
    return synced === undefined
      ? cached !== null
      : cached === null || Date.parse(synced) !== cached.updatedAt.getTime()
  })
  renderCache.invalidate()
  invalidateLists()
}

// 同期で全件が入れ替わったとき (docs/123 §5)
export function everythingChanged(): void {
  noteCache.invalidate()
  renderCache.invalidate()
  circuitsCache.invalidate()
  invalidateLists()
}
