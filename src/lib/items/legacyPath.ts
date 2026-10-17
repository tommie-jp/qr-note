import { isLegacyItemNo } from '@/lib/validation'

// 旧番号のノート URL (`/item/1003`・`/edit/1003`・`/print/1003`・
// `/item/1003/history[/<oid>]`) を切り分ける (docs/107-ノート主キー計画.md §3-2)。
//
// **転送は proxy.ts で返す**。ページの中 (pageGuard) で redirect すると、
// loading.tsx の Suspense が描画を流し始めた後なので、HTTP の 308 ではなく
// 200 + `<meta http-equiv="refresh">` になる。ブラウザは着くが、X のカードの
// 取得や検索エンジンには転送として伝わらない。proxy なら描画の前に返せる。
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
