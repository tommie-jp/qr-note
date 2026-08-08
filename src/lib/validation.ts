export type Mode = 'memo' | 'url'

// memo / url 1 件の文字数上限。フォーム投稿 (actions.ts) と ENEX インポート
// (lib/enex/importEnex.ts) の両方が同じ上限を見る。片方だけ緩いと、取り込めた
// のに編集画面から保存し直せないノートができる
export const MAX_TEXT_LENGTH = 10000

// Ver1 の実データは 4 桁数字が大半だが、"100x" のような
// 非数字の itemNo も 1 件存在するため英数字を許容する
const ITEM_NO_PATTERN = /^[0-9A-Za-z_-]{1,20}$/

export function isValidItemNo(itemNo: string): boolean {
  return ITEM_NO_PATTERN.test(itemNo)
}

// DB の item_no_num 列は Int (int4) なので、その範囲を超える値は入れない
const INT4_MAX = 2147483647

// 一覧の数値ソート用。非数字・int4 範囲外の itemNo は null (末尾に表示)
export function itemNoToNum(itemNo: string): number | null {
  if (!/^[0-9]+$/.test(itemNo)) {
    return null
  }
  const num = Number(itemNo)
  return num <= INT4_MAX ? num : null
}

// Prisma の contains / startsWith は LIKE メタ文字をエスケープしないため、
// 検索語の % _ \ をエスケープする (PostgreSQL の LIKE の既定エスケープは \)
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

// Ver1 は mode 未設定を "memo" として扱っていた (edit 画面の挙動)
export function parseMode(value: unknown): Mode {
  return value === 'url' ? 'url' : 'memo'
}

// 一覧の並び順の種別。accessed = 最近見た順 (docs/37-アクセス順計画.md)、
// title = 一覧の見出し順 (docs/63-タイトル順計画.md)
export type SortBase = 'itemNo' | 'updated' | 'accessed' | 'title'

// 種別を逆向きに辿る並び (docs/64-並び順逆順計画.md)。
//
// **種別と方向を 1 本の文字列に畳む**のが要点。cookie も URL も
// `?sort=` 1 つで、items.ts / searchUrl.ts / 前後ナビもこの 1 値を持ち回す
// 形になっている。方向を別のパラメータにすると全部の経路が二本立てになる。
//
// 名前は「種別 + 逆向きの方向」。基底の 4 値が**その種別の既定の方向**を
// 指すのは変えないので、前に選んだ cookie (寿命 1 年) も共有された
// `?sort=title` も、意味が変わらないまま開ける (移行処理が要らない)
export type ReversedSort = 'itemNoDesc' | 'updatedAsc' | 'accessedAsc' | 'titleDesc'

export type Sort = SortBase | ReversedSort

// 妥当な並びをすべて並べた表。parseSort の判定と、UI 側が 8 値ぶんの
// 表を組み立てるときの元になる (lib/sortDirection.ts の bySort)
export const SORTS: readonly Sort[] = [
  'updated',
  'accessed',
  'itemNo',
  'title',
  'updatedAsc',
  'accessedAsc',
  'itemNoDesc',
  'titleDesc',
]

// Ver1 の /search と同じく更新日降順を既定にする。
// **既定を変えない**のが要点 — アクセス順やタイトル順、逆順は明示的に
// 選んだときだけ使う (日常の画面が導入で突然変わらないように)
export function parseSort(value: unknown): Sort {
  return SORTS.includes(value as Sort) ? (value as Sort) : 'updated'
}

export function buildItemUrl(baseUrl: string, itemNo: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/item/${itemNo}`
}
