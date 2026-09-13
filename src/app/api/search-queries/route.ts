import type { NextResponse } from 'next/server'
import { parseJsonBody } from '@/lib/route/parse'
import { apiOk } from '@/lib/route/respond'
import { sanitizeQueryList } from '@/lib/searchQueries'
import { recordableQueryOf, searchQueryUser } from '@/lib/searchQueryRoute'
import { importSavedQueries, listQueries, recordUse } from '@/lib/searchQueryStore'

// 検索履歴と登録パターンの口 (docs/59-検索候補計画.md §7)。
//
//   GET  … 2 つのリストを最近使った順で返す (検索窓にフォーカスした時)
//   POST … 「使った」の記録 (Enter・候補の確定・結果を開く・タグを押す)
//   PUT  … localStorage に残っていた登録パターンの引き取り (1 回だけ)
//
// ☆ の登録・解除は saved/route.ts が持つ。どの口も応答は同じ形 (2 つのリスト)
// で、クライアントは返ってきた物でそのまま手元を差し替えられる。

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await searchQueryUser(request)
  if (!guard.ok) {
    return guard.response
  }
  return apiOk(await listQueries(guard.user))
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await searchQueryUser(request)
  if (!guard.ok) {
    return guard.response
  }

  const query = await parseJsonBody(request, recordableQueryOf)
  if (!query.ok) {
    return query.response
  }

  return apiOk(await recordUse(guard.user, query.value))
}

// localStorage から引き取る (docs/59-検索候補計画.md §7)。
//
// 空配列でも 200 を返す。クライアントは「返事が来た = サーバは受け取った」を
// もって localStorage を消すので、ここで断ると消せないまま毎回送り直しになる。
export async function PUT(request: Request): Promise<NextResponse> {
  const guard = await searchQueryUser(request)
  if (!guard.ok) {
    return guard.response
  }

  // 覚えられない物 (空・長すぎ・文字列でない) は黙って落とす。手で編集できる
  // localStorage から来た値なので、1 件の形式違いで全部を捨てさせない
  const saved = await parseJsonBody(request, (body) => sanitizeQueryList(body.saved))
  if (!saved.ok) {
    return saved.response
  }
  return apiOk(await importSavedQueries(guard.user, saved.value))
}
