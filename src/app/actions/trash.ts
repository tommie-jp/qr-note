'use server'

import { redirect } from 'next/navigation'
import { isDemoMode } from '@/lib/appEnv'
import { removeNotes } from '@/lib/git/notesRepo'
import { emptyTrash, purgeItems, restoreItems, trashItems } from '@/lib/items/trash'
import { parseBackUrl, parseSelectedItemNos } from '@/lib/items/itemSelection'
import { requireUser } from '@/lib/auth/session'
import { revalidateItem, revalidateLists } from './_revalidate'

// --- ゴミ箱 (二段階削除。docs/12-ゴミ箱計画.md) ---

// 検索結果で選択したノートをゴミ箱へ入れる (復元できるので confirm は出さない)。
// 一括タグと同じフォームから formAction で分岐して呼ばれる。
export async function trashItemsAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNos = parseSelectedItemNos(formData)
  const back = parseBackUrl(formData)

  if (itemNos.length > 0) {
    await trashItems(itemNos)
    revalidateLists()
  }

  redirect(back)
}

// ゴミ箱から戻す。/trash の「復元」と /item のバナーの両方から呼ばれ、
// どちらも同じルートを revalidate すれば呼び出し元がそのまま描き直される
// (Next.js は revalidatePath で現在のルートを再レンダリングして返す)。
export async function restoreItemsAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNos = parseSelectedItemNos(formData)
  if (itemNos.length === 0) {
    return
  }

  await restoreItems(itemNos)
  revalidateLists()
  for (const itemNo of itemNos) {
    revalidateItem(itemNo)
  }
}

// 永久削除。ゴミ箱にある行しか消せないことは items.ts の purgeItems が保証する
// (UI の confirm は最後の一押しで、防護そのものではない)。
export async function purgeItemsAction(formData: FormData): Promise<void> {
  await requireUser()
  const itemNos = parseSelectedItemNos(formData)
  if (itemNos.length === 0) {
    return
  }

  const purged = await purgeItems(itemNos)
  await tombstoneNotes(purged)
  revalidateLists()
}

export async function emptyTrashAction(): Promise<void> {
  await requireUser()
  const purged = await emptyTrash()
  await tombstoneNotes(purged)
  revalidateLists()
}

// 永久削除を git 履歴にも「この版で消えた」として刻む墓石コミット
// (docs/57-ノートgit履歴計画.md §4)。対象は purgeItems / emptyTrash が返す
// **実際に消えた itemNo だけ** (消えなかったノートの履歴に墓石を立てない)。
//
// 失敗しても投げない。DB の削除はもう終わっていて、git の都合で削除操作を
// エラーにする理由がない (履歴にファイルが残るだけで無害。次に同じ番号を
// 使って永久削除すればそのとき消える)。ただし黙らせはせずログには残す。
async function tombstoneNotes(itemNos: string[]): Promise<void> {
  if (itemNos.length === 0 || isDemoMode()) {
    return
  }
  const message =
    itemNos.length === 1 ? `delete ${itemNos[0]}` : `delete ${itemNos.length} notes`
  try {
    await removeNotes(itemNos, message)
  } catch (error) {
    console.error(`git 履歴の墓石コミットに失敗しました (${itemNos.join(', ')}):`, error)
  }
}
