'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseBulkTagForm } from '@/lib/bulkTags'
import { modifyMemo } from '@/lib/items/write'
import { requireUser } from '@/lib/session'
import { addTagsToMemo, removeTagsFromMemo } from '@/lib/tagEdit'

// 検索結果で選択した複数ノートへ、タグをまとめて追加/削除する。
// タグの正本はメモ本文なので、本文を書き換えて upsertMemo で保存し
// items.tags を再計算させる (tagEdit.ts 参照)。実際に本文が変わったノートだけ
// 保存するので、文章中にしかないタグの削除など「効かない」操作では更新しない。
export async function bulkTagAction(formData: FormData): Promise<void> {
  await requireUser()
  const { mode, itemNos, tags, back } = parseBulkTagForm(formData)

  if (itemNos.length > 0 && tags.length > 0) {
    for (const itemNo of itemNos) {
      // ここも modifyMemo を通す (docs/87 §2-5)。タグの位置は本文で決まるので
      // 当て直しは安全 (canRetry は要らない)。
      //
      // **行が無ければ何もしない** ('missing' を捨てる)。upsert だった頃は
      // タグだけのノートを作りえたが、対象は検索結果から選ばれた番号なので
      // 実際には起こらず、作るほうが驚きになる
      await modifyMemo(itemNo, (memo) =>
        mode === 'add' ? addTagsToMemo(memo, tags) : removeTagsFromMemo(memo, tags),
      )
    }
    revalidatePath('/')
  }

  redirect(back)
}
