'use server'

import { readItemId } from '@/lib/actionForm'
import { hasNoteNumber } from '@/lib/items/noteNumber'
import { nextFreeNoteNumber } from '@/lib/items/noteNumber.server'
import { getItem } from '@/lib/items/read'
import { modifyMemo } from '@/lib/items/write'
import { addTagToMemo } from '@/lib/markdown/tags/edit'
import { extractTags } from '@/lib/markdown/tags/tags'
import { requireUserOutsideDemo } from './_guards'
import { revalidateItem, revalidateLists } from './_revalidate'

// --- 番号を振る (docs/111-短縮URL計画.md §6) ---

// ノートに 4 桁の番号タグ (#1234) を足す。これで短縮 URL `/s/1234` と
// 小さい印刷 QR が使えるようになる。
//
// 番号の正本は本文のタグなので、本文を書き換えて保存する (bulkTagAction と同じ)。
// 列やフラグは持たない (docs/107 §2-2)。
//
// **既に番号があれば何もしない** (1 つでも 2 つでも) — 押し直しや二重送信で
// 番号が増えると、どれを QR に載せるかが決まらなくなる (noteNumberOf は 2 つ以上なら null)。
// 読んでから書くまでに別の端末が振った場合も、書き換えの中で見直して足さない。
//
// 空き番号を引いてから書くまでの間に、別のノートが同じ番号を取ることはありうる。
// 防がない — `/s/1234` が 2 件なら検索一覧に落ちるだけ (docs/111 §2-3)
export async function assignNoteNumberAction(formData: FormData): Promise<void> {
  // デモは公開と同じく閉じる。種 DB の番号が毎時のリセットで戻り、
  // 刷った QR が別のノートを指すことになるため
  await requireUserOutsideDemo('デモモードでは番号は振れません')
  const itemId = readItemId(formData)

  const item = await getItem(itemId)
  if (item === null) {
    throw new Error('ノートが見つかりません')
  }
  if (hasNoteNumber(item.tags)) {
    return
  }

  const noteNumber = await nextFreeNoteNumber()
  if (noteNumber === null) {
    throw new Error('空き番号がありません (1000〜9999)')
  }

  const result = await modifyMemo(itemId, (memo) =>
    hasNoteNumber(extractTags(memo)) ? memo : addTagToMemo(memo, noteNumber),
  )
  if (result === 'missing') {
    throw new Error('ノートが見つかりません')
  }
  revalidateItem(itemId)
  // タグは検索条件そのもの。一覧とゴミ箱も描き直す
  revalidateLists()
}
