// 検索履歴の口が共通で使う門番 (docs/59-検索候補計画.md §7)。
//
// 4 つのメソッド (GET / POST / PUT / DELETE) がまったく同じ前提を要るので、
// 「通れば誰か・通らなければ返す応答」を 1 か所にまとめる。判定を各 route に
// 書き写すと、片方だけ直して穴が開く。

import { isDemoMode } from './appEnv'
import { guardRequest, type GuardResult } from './route/guard'
import { apiOk } from './route/respond'
import { isRecordableQuery, type QueryLists } from './searchQueries'

export function emptyLists(): QueryLists {
  return { saved: [], recent: [] }
}

// 本文 { query } から覚えてよいクエリを取り出す (parseJsonBody の check)。
// 記録・登録・解除の 3 つが同じ形を受ける
export function recordableQueryOf(body: Readonly<Record<string, unknown>>): string | null {
  const { query } = body
  return isRecordableQuery(query) ? query : null
}

// 誰の履歴かを決める。**セッションだけを見る** — 本文で名乗らせると、
// ログインさえしていれば他人の履歴を読み書きできてしまう。
//
// 戻り値は route/guard.ts の guardRequest と同じ形。ok なら user が誰か、
// そうでなければ response をそのまま返す。
//
// **デモは断らずに空を返す**。デモは共有アカウント (docs/38-デモモード計画.md)
// なので、履歴を持たせると訪問者どうしで検索語を見せ合うことになる。かといって
// 403 にすると画面がエラーを抱えるので、「何も覚えていない」として振る舞う —
// 候補が出ないだけで検索そのものは動く。
//
// 使い方:
//   const guard = await searchQueryUser(request)
//   if (!guard.ok) return guard.response
export async function searchQueryUser(request: Request): Promise<GuardResult> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard
  }
  if (isDemoMode()) {
    return { ok: false, response: apiOk(emptyLists()) }
  }
  return guard
}
