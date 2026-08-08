// 検索履歴の口が共通で使う門番 (docs/59-検索候補計画.md §7)。
//
// 4 つのメソッド (GET / POST / PUT / DELETE) がまったく同じ前提を要るので、
// 「通れば誰か・通らなければ返す応答」を 1 か所にまとめる。判定を各 route に
// 書き写すと、片方だけ直して穴が開く。

import type { NextResponse } from 'next/server'
import { apiFail, apiOk } from './authApi'
import { isDemoMode } from './appEnv'
import { denyCrossSite, denyUnlessLoggedIn } from './apiAuth'
import type { QueryLists } from './searchQueries'
import { currentUser } from './session'

export function emptyLists(): QueryLists {
  return { saved: [], recent: [] }
}

// 誰の履歴かを決める。**セッションだけを見る** — 本文で名乗らせると、
// ログインさえしていれば他人の履歴を読み書きできてしまう。
//
// 戻り値が string なら通過、NextResponse ならそれをそのまま返す。
//
// **デモは断らずに空を返す**。デモは共有アカウント (docs/38-デモモード計画.md)
// なので、履歴を持たせると訪問者どうしで検索語を見せ合うことになる。かといって
// 403 にすると画面がエラーを抱えるので、「何も覚えていない」として振る舞う —
// 候補が出ないだけで検索そのものは動く。
//
// 使い方:
//   const user = await searchQueryUser(request)
//   if (typeof user !== 'string') return user
export async function searchQueryUser(request: Request): Promise<string | NextResponse> {
  const denied = (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  if (denied) {
    return denied
  }
  if (isDemoMode()) {
    return apiOk(emptyLists())
  }
  const userName = await currentUser()
  if (userName === null) {
    // denyUnlessLoggedIn を通った後なのでここへは来ない。素通しにせず断る
    return apiFail('ログインが必要です', 401)
  }
  return userName
}
