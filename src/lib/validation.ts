// 本文 1 件の文字数上限。フォーム投稿 (actionForm.ts)・ENEX インポート
// (lib/enex/importEnex.ts)・ZIP インポート (lib/zip/noteFile.ts)・編集画面の
// 打ち止め (editor/hooks/useEditorExtensions.ts の changeFilter) が**同じ上限を見る**。片方だけ緩いと、取り込めた
// のに編集画面から保存し直せないノートができる。
//
// 10,000 字から上げた (docs/74-ページ計画.md §7)。ページは本文が伸びる前提の
// 機能で、1 ページ 500 字 × 60 ページを目安にした。上げすぎないのは、この列が
// pg_dump・git 履歴 (notes/<itemId>.md)・オフライン同期の全部を通るため
export const MAX_TEXT_LENGTH = 32000

// ノートの識別子 (docs/107-ノート主キー計画.md §2-1)。UUID v7 の小文字表記。
//
// DB の列は uuid 型なので、**形の違う文字列を SQL まで持ち込まない**のが要点。
// 持ち込むと `invalid input syntax for type uuid` で 500 になる。URL・フォーム・
// ZIP から来た値は、ここを通してから引く。大文字は受けない (URL を 1 つに保つ)
const ITEM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isValidItemId(itemId: string): boolean {
  return ITEM_ID_PATTERN.test(itemId)
}

// 旧番号 (Ver1 の itemNo と教科書の wb01-03-08 など) の形。
//
// 主キーではなくなったが、印刷済みシールと X に投稿済みの URL
// (`/item/1003`) を受けるために形だけは見分ける (docs/107 §3-2)。
// 旧番号は移行で本文タグ `#1003` になったので、引くのはタグ検索
const LEGACY_ITEM_NO_PATTERN = /^[0-9A-Za-z_-]{1,20}$/

export function isLegacyItemNo(value: string): boolean {
  return LEGACY_ITEM_NO_PATTERN.test(value) && !isValidItemId(value)
}

// Prisma の contains / startsWith は LIKE メタ文字をエスケープしないため、
// 検索語の % _ \ をエスケープする (PostgreSQL の LIKE の既定エスケープは \)
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

// 一覧の並び順の種別。accessed = 最近見た順 (docs/37-アクセス順計画.md)、
// title = 一覧の見出し順 (docs/63-タイトル順計画.md)
export type SortBase = 'registered' | 'updated' | 'accessed' | 'title'

// 種別を逆向きに辿る並び (docs/64-並び順逆順計画.md)。
//
// **種別と方向を 1 本の文字列に畳む**のが要点。cookie も URL も
// `?sort=` 1 つで、items/ / search/url.ts / 前後ナビもこの 1 値を持ち回す
// 形になっている。方向を別のパラメータにすると全部の経路が二本立てになる。
//
// 名前は「種別 + 逆向きの方向」。基底の 4 値が**その種別の既定の方向**を
// 指すのは変えないので、前に選んだ cookie (寿命 1 年) も共有された
// `?sort=title` も、意味が変わらないまま開ける (移行処理が要らない)
export type ReversedSort = 'registeredDesc' | 'updatedAsc' | 'accessedAsc' | 'titleDesc'

export type Sort = SortBase | ReversedSort

// 妥当な並びをすべて並べた表。parseSort の判定と、UI 側が 8 値ぶんの
// 表を組み立てるときの元になる (lib/prefs/sortDirection.ts の bySort)
export const SORTS: readonly Sort[] = [
  'updated',
  'accessed',
  'registered',
  'title',
  'updatedAsc',
  'accessedAsc',
  'registeredDesc',
  'titleDesc',
]

// Ver1 の /search と同じく更新日降順を既定にする。
// **既定を変えない**のが要点 — アクセス順やタイトル順、逆順は明示的に
// 選んだときだけ使う (日常の画面が導入で突然変わらないように)
export function parseSort(value: unknown): Sort {
  const sort = LEGACY_SORTS[String(value)] ?? value
  return SORTS.includes(sort as Sort) ? (sort as Sort) : 'updated'
}

// 番号順 (itemNo) は登録順 (registered) になった (docs/107 §4-6)。旧い名前は
// cookie (寿命 1 年)・共有した URL・本文のリンク (教科書の目次の `&sort=itemNo`)・
// matrix フェンスに残っているので、読むときに新しい名前へ寄せる
export const LEGACY_SORTS: Readonly<Record<string, Sort>> = {
  itemNo: 'registered',
  itemNoDesc: 'registeredDesc',
}

// ゴミ箱だけが持つ並び (docs/67-ゴミ箱表示形式計画.md §2)。
//
// **共有の Sort には混ぜない**のが要点。deleted_at は検索一覧では必ず null
// なので、`/?sort=deleted` は「全件が同着」という意味のない並びになる。
// 型を分けておけば、検索側の parseSort がゴミ箱の値を既定へ倒してくれる。
//
// 逆に Sort の 4 種別はゴミ箱でもそのまま使える (更新順で消し忘れを探す、
// 登録順で古いものから見る) ので、TrashSort は Sort を含む上位集合にする。
export type TrashSortBase = SortBase | 'deleted'
export type TrashSort = Sort | 'deleted' | 'deletedAsc'

export const TRASH_SORTS: readonly TrashSort[] = [
  'deleted',
  'deletedAsc',
  ...SORTS,
]

// ゴミ箱の既定は削除順 (新しい順)。今までの並び (deleted_at desc 固定) と
// 同じにして、この機能が入っても何もしていない人の画面は変わらないようにする
export function parseTrashSort(value: unknown): TrashSort {
  const sort = LEGACY_SORTS[String(value)] ?? value
  return TRASH_SORTS.includes(sort as TrashSort) ? (sort as TrashSort) : 'deleted'
}

export function buildItemUrl(baseUrl: string, itemId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/item/${itemId}`
}
