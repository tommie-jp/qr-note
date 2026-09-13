import { revalidatePath } from 'next/cache'

// サーバーアクションが書き込んだ後に描き直させる画面の組 (docs/93-リファクタリング計画.md §4-6)。
// 'use server' を付けない理由は _guards.ts と同じ (付けると外から呼べる口になる)

// ノート 1 件の画面
export function revalidateItem(itemNo: string): void {
  revalidatePath(`/item/${itemNo}`)
}

// 検索一覧とゴミ箱。ゴミ箱の出し入れはどちらの一覧にも効く
export function revalidateLists(): void {
  revalidatePath('/')
  revalidatePath('/trash')
}
