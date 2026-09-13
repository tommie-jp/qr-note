import type { NextResponse } from 'next/server'
import { denyCrossSite, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { buildImageSearchIndex } from '@/lib/imageSearchIndex'
import { apiOk } from '@/lib/route/respond'

// 画像検索の索引を配る (docs/25-画像検索計画.md §5)。
// ゴミ箱を除く全ノートの埋め込み済み画像を [{itemNo,title,imageName,embedding}]
// で返す。照合はクライアントで総当たり cosine を取る (imageSearch.ts)。
//
// 登録画像の見た目が漏れると困る (非公開の在庫) ので、ログインと同一サイトの
// 両方を確かめる。/api/images と同じ門番 (apiAuth.ts)。
export async function GET(request: Request): Promise<NextResponse> {
  const denied = (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  if (denied) {
    return denied
  }

  const entries = await buildImageSearchIndex()
  // 端末ごと・時点ごとに変わる索引なのでキャッシュさせない (apiOk の既定の no-store)
  return apiOk({ entries })
}
