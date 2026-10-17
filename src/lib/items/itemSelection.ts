// 検索結果で選択したノートに対する一括操作フォームの共通部分 (DB 非依存)。
// 一括タグ (markdown/tags/bulk.ts) とゴミ箱行き (app/actions/trash.ts の trashItemsAction) が
// 同じ形のフォーム (itemId[] + q/page/sort) を送るため、解釈をここに集約する。

import { buildSearchUrl } from '../search/url'
import { isValidItemId, parseSort } from '../validation'

// 1 回の一括操作で処理する最大アイテム数。オンデマンド表示 (docs/33) で
// 選択は読み込んだ全件に及ぶようになったため、全ノート規模 (数百〜数千)
// を上限にする。細工されたフォームに備えてループを有界にする意図は同じ。
const MAX_BULK_ITEMS = 5000

// チェックされた itemId を検証済み・重複なしで返す (フォームの並び順)。
export function parseSelectedItemIds(formData: FormData): string[] {
  const seen = new Set<string>()
  const itemIds: string[] = []
  for (const value of formData.getAll('itemId')) {
    if (typeof value !== 'string' || !isValidItemId(value) || seen.has(value)) {
      continue
    }
    seen.add(value)
    itemIds.push(value)
    if (itemIds.length >= MAX_BULK_ITEMS) {
      break
    }
  }
  return itemIds
}

// 操作後に戻る一覧 URL。検索状態 (q/page/sort) から**必ずここで組み立てる**。
// フォームの値をそのまま redirect 先にするとオープンリダイレクトになるため、
// 戻り先の形は buildSearchUrl の `/?q=…` に限定する。
export function parseBackUrl(formData: FormData): string {
  const page = Number(formData.get('page')) || 1
  return buildSearchUrl(
    String(formData.get('q') ?? ''),
    page,
    parseSort(formData.get('sort')),
  )
}

// 1 件だけをゴミ箱へ入れるときのフォーム内容 (行のスワイプ・ホバーの
// ゴミ箱ボタン・長押しメニュー。docs/66-行アクション計画.md)。
//
// **戻り先の 3 つを必ず載せる。** trashItemsAction は最後に
// redirect(parseBackUrl(formData)) を呼ぶので、載せ忘れると素の / へ飛ばされ、
// 「検索して 1 件消したら全件の先頭に居た」になる。一括操作の側は
// BulkTagToolbar の hidden が同じ 3 つを送っており、1 件の側だけ抜けていた。
//
// 手で FormData を組む場所が増えたので、ここに 1 本化して検査を効かせる
// (組み立てはブラウザの中でしか走らず、抜けても型では捕まらない)。
// ノート 1 件を指すフォーム (itemId だけ)。parseSelectedItemIds と対で、
// 項目名をここ 1 か所に置く。ゴミ箱の画像表示の復元・永久削除が使う
// (docs/107 §9)。手で組むと、項目名が変わったときに空の選択を送り、
// サーバーアクションが黙って何もしない
export function buildItemFormData(itemId: string): FormData {
  const formData = new FormData()
  formData.append('itemId', itemId)
  return formData
}

export function buildTrashFormData(
  itemId: string,
  back: { q: string; page: number; sort: string },
): FormData {
  const formData = buildItemFormData(itemId)
  formData.append('q', back.q)
  formData.append('page', String(back.page))
  formData.append('sort', back.sort)
  return formData
}
