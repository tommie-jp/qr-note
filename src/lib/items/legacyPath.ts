import { isLegacyItemNo } from '@/lib/validation'
import { SHORT_ITEM_PREFIX } from './noteNumber'

// 旧番号のノート URL (`/item/1003`・`/edit/1003`・`/print/1003`・
// `/item/1003/history[/<oid>]`) を切り分ける (docs/107-ノート主キー計画.md §3-2)。
//
// **転送は proxy.ts で返す**。ページの中 (pageGuard) で redirect すると、
// loading.tsx の Suspense が描画を流し始めた後なので、HTTP の 308 ではなく
// 200 + `<meta http-equiv="refresh">` になる。ブラウザは着くが、X のカードの
// 取得や検索エンジンには転送として伝わらない。proxy なら描画の前に返せる。
//
// 短縮 URL `/s/1234` (docs/111-短縮URL計画.md) も `/item/1234` の別名として
// ここで受け、着地の prefix を `/item/` に写す。解き方は旧番号と同じ (本文のタグ)。
// 短縮 URL は続き (/history) を取らない。
//
// DB には触らない純関数 (proxy.ts が解決と組み立てを受け持つ)。UUID は旧番号の
// 形に当たらないので null になり、そのまま素通しされる
export interface LegacyItemPath {
  key: string
  // id に付け替えるとき前後に残す部分
  prefix: '/item/' | '/edit/' | '/print/'
  suffix: string
}

const LEGACY_PATH = /^(\/item\/|\/edit\/|\/print\/)([^/]+)(\/history(?:\/[0-9a-f]{40})?)?$/

export function parseLegacyItemPath(pathname: string): LegacyItemPath | null {
  if (pathname.startsWith(SHORT_ITEM_PREFIX)) {
    const key = pathname.slice(SHORT_ITEM_PREFIX.length)
    return isLegacyItemNo(key) ? { key, prefix: '/item/', suffix: '' } : null
  }
  const match = LEGACY_PATH.exec(pathname)
  if (match === null) {
    return null
  }
  const [, prefix, key, suffix = ''] = match
  // 履歴が付くのは /item だけ
  if (suffix !== '' && prefix !== '/item/') {
    return null
  }
  if (!isLegacyItemNo(key)) {
    return null
  }
  return { key, prefix: prefix as LegacyItemPath['prefix'], suffix }
}
