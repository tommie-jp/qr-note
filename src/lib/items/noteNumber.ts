// ノートの番号タグと短縮 URL (docs/111-短縮URL計画.md)。
//
// 短縮 URL `https://qr.tommie.jp/s/1234` は、本文に番号タグ `#1234` を持つノート
// だけが受けられる。**対応表も列も持たない** — 番号の正本は本文のタグで、
// 引くのは旧番号と同じ resolveItemKey (lib/items/resolve.ts)。docs/107 §2-2 の
// 「2 つ目の識別子を持たない」を守るため。
//
// DB に触らない純関数だけを置く (空き番号を引くのは noteNumber.server.ts)。
// 印刷ページ・ボタン・テストのどれからも読めるようにするため

// 番号の形。1000〜9999 の 4 桁で、旧採番 (docs/10 §4) と同じ範囲。
// JAN / ISBN (13 桁) とは桁で見分けられる。年号 (#2026) のような 4 桁のタグも
// 番号と見なされるのは承知の上 (docs/111 §2-2)
const NOTE_NUMBER_PATTERN = /^[1-9][0-9]{3}$/
export const NOTE_NUMBER_MIN = 1000
export const NOTE_NUMBER_MAX = 9999

// SQL の正規表現。NOTE_NUMBER_PATTERN と同じ集合 (noteNumber.test.ts が照合する)
export const NOTE_NUMBER_SQL_PATTERN = '^[1-9][0-9]{3}$'

export function isNoteNumber(tag: string): boolean {
  return NOTE_NUMBER_PATTERN.test(tag)
}

// 番号タグを 1 つでも持つか。「番号を振る」を出すか・振ってよいかの判定
export function hasNoteNumber(tags: readonly string[]): boolean {
  return tags.some(isNoteNumber)
}

// ノートの番号。番号タグが**ちょうど 1 つ**のときだけ返す。
// 2 つ以上あると、どれを QR に載せるかが決まらない。印刷は id の URL に倒す
export function noteNumberOf(tags: readonly string[]): string | null {
  const numbers = tags.filter(isNoteNumber)
  return numbers.length === 1 ? numbers[0] : null
}

// 1000 以上の最小の空き番号。尽きていれば null。
// used はゴミ箱も含む全ノートのタグ (番号以外が混ざっていてよい)。
// ゴミ箱の行が番号を予約するのは旧採番と同じ (永久削除で空く)
export function firstFreeNoteNumber(used: Iterable<string>): string | null {
  const taken = new Set<number>()
  for (const tag of used) {
    if (isNoteNumber(tag)) {
      taken.add(Number(tag))
    }
  }
  for (let n = NOTE_NUMBER_MIN; n <= NOTE_NUMBER_MAX; n++) {
    if (!taken.has(n)) {
      return String(n)
    }
  }
  return null
}

// 短縮 URL の接頭辞。proxy (lib/items/legacyPath.ts)・公開パス
// (lib/auth/publicPaths.ts)・スキャナ (lib/external/scanResult.ts) と同じ
export const SHORT_ITEM_PREFIX = '/s/'

// 短縮 URL。buildItemUrl (validation.ts) と同じく qrBaseUrl() を起点にする。
// `https://` は落とさない — URL と認識しないカメラアプリがある
export function buildShortItemUrl(baseUrl: string, noteNumber: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${SHORT_ITEM_PREFIX}${noteNumber}`
}
