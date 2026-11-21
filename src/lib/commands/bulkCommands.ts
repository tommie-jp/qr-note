// 複数のノートをまとめて書き換える本体 (docs/123 §2-1)。もとは
// app/actions/trash.ts・tags.ts・offline.ts の Server Action の中身
import 'server-only'
import { revalidatePath } from 'next/cache'
import { isDemoMode } from '@/lib/appEnv'
import { renderCircuits } from '@/lib/circuit/cache'
import { removeNotes } from '@/lib/git/notesRepo'
import { setItemOfflinePin } from '@/lib/items/flags'
import { getItem } from '@/lib/items/read'
import { emptyTrash, purgeItems, restoreItems, trashItems } from '@/lib/items/trash'
import { modifyMemo } from '@/lib/items/write'
import { changedTagsOf, type TagChange } from '@/lib/markdown/tags/bulk'
import {
  addTagsToMemo,
  removeTagsWithEdits,
  restoreRemovedTags,
  type TagLineEdit,
} from '@/lib/markdown/tags/edit'

// ゴミ箱の出し入れは公開ノートの画面 (サーバ描画) にも効く
function revalidatePublicViews(itemIds: readonly string[]): void {
  for (const itemId of itemIds) {
    revalidatePath(`/item/${itemId}`)
  }
}

export type TrashOp = 'trash' | 'restore' | 'purge' | 'empty'

export async function applyTrashOp(op: TrashOp, itemIds: readonly string[]): Promise<void> {
  switch (op) {
    case 'trash':
      if (itemIds.length > 0) {
        await trashItems([...itemIds])
        revalidatePublicViews(itemIds)
      }
      return
    case 'restore':
      if (itemIds.length > 0) {
        await restoreItems([...itemIds])
        revalidatePublicViews(itemIds)
      }
      return
    case 'purge':
      if (itemIds.length > 0) {
        await tombstoneNotes(await purgeItems([...itemIds]))
      }
      return
    case 'empty':
      await tombstoneNotes(await emptyTrash())
      return
  }
}

// 完全削除したノートを git 履歴でも消す (docs/57 §6)。失敗しても削除は成功のまま
async function tombstoneNotes(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0 || isDemoMode()) {
    return
  }
  const message = itemIds.length === 1 ? `delete ${itemIds[0]}` : `delete ${itemIds.length} notes`
  try {
    await removeNotes(itemIds, message)
  } catch (error) {
    console.error(`git 履歴の墓石コミットに失敗しました (${itemIds.join(', ')}):`, error)
  }
}

// 返すのはノートごとに実際に増えた (外れた) タグ。変化の無かったノートは
// 入れない。端末はこれを控え、「元に戻す」で増えた分だけを外す。外したときは
// 書き換えたタグ行の控え (lines) も付ける — 取り消しで元の位置に差し戻すため
export async function applyBulkTags(
  mode: 'add' | 'remove',
  itemIds: readonly string[],
  tags: readonly string[],
): Promise<TagChange[]> {
  if (itemIds.length === 0 || tags.length === 0) {
    return []
  }
  const changes: TagChange[] = []
  for (const itemId of itemIds) {
    // 競合で当て直したときは最後に当てた本文の差を採る (書かれたのはそれ)
    let changed: string[] = []
    let lines: TagLineEdit[] = []
    const outcome = await modifyMemo(itemId, (memo) => {
      const result =
        mode === 'add' ? { memo: addTagsToMemo(memo, [...tags]), edits: [] } : removeTagsWithEdits(memo, tags)
      lines = result.edits
      changed = changedTagsOf(mode, memo, result.memo, tags)
      return result.memo
    })
    if (outcome === 'saved' && changed.length > 0) {
      changes.push(mode === 'add' ? { itemId, tags: changed } : { itemId, tags: changed, lines })
    }
  }
  return changes
}

// 一括削除の取り消し。外したタグ行を元の位置・元の書き方に差し戻す。
// 本文がその後に変わって位置が合わないノートは、追加の規則で足し直す
export async function restoreRemovedTagChanges(changes: readonly TagChange[]): Promise<void> {
  for (const { itemId, tags, lines = [] } of changes) {
    await modifyMemo(itemId, (memo) => restoreRemovedTags(memo, tags, lines))
  }
}

// オフラインの印 (docs/65 §7)。付けるときは回路図を先に描いておく
// (圏外では描けない)。描けなくても印は付いたまま
export async function setOfflinePins(itemIds: readonly string[], pinned: boolean): Promise<void> {
  for (const itemId of itemIds) {
    await setItemOfflinePin(itemId, pinned)
    if (!pinned) {
      continue
    }
    const item = await getItem(itemId)
    if (item === null) {
      continue
    }
    try {
      await renderCircuits(item.memo)
    } catch (error) {
      console.warn(`オフライン用の回路図を描けませんでした (${itemId})`, error)
    }
  }
}
