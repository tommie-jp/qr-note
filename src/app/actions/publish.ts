'use server'

import { readItemNo } from '@/lib/actionForm'
import { setItemPublic } from '@/lib/items/flags'
import { requireUserOutsideDemo } from './_guards'
import { revalidateItem } from './_revalidate'

// --- 公開 (docs/22-ノート公開計画.md) ---

// ノートを公開する / 公開をやめる。
//
// フォームは**望む状態** (public=1 / 0) を送る。「いまの状態を裏返す」に
// すると、二重送信や戻るボタンで意図と逆に倒れる (docs/22 §7)。
//
// ログインの検査は飾りではない。これは誰でも叩ける POST の口で、
// もし通れば「他人が自分のノートを勝手に公開できる」ことになる。
// proxy.ts も未ログインの POST は 401 にするが、それは楽観的な検査でしかない。
export async function setItemPublicAction(formData: FormData): Promise<void> {
  // デモインスタンスでは公開機能そのものを無効にする (docs/38-デモモード計画.md §3)。
  // UI ではトグルを出さない (ItemView) が、Server Action は画面を通さず id さえ
  // 判れば叩ける口なので、ここでも塞ぐ。isPublicItem() 側でも公開を認めないので
  // 二重の防御になる (万一 public_at が立っても未ログインには見えない)。
  await requireUserOutsideDemo('デモモードでは公開機能は使えません')
  const itemNo = readItemNo(formData)
  // '1' だけを公開と読む。判らない値は非公開へ倒す (既定を閉じる側へ)
  const isPublic = formData.get('public') === '1'
  await setItemPublic(itemNo, isPublic)
  revalidateItem(itemNo)
}
