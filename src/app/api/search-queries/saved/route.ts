import { NextResponse } from 'next/server'
import { apiFail, apiOk, readJsonObject } from '@/lib/authApi'
import { isRecordableQuery, SAVED_LIMIT } from '@/lib/searchQueries'
import { searchQueryUser } from '@/lib/searchQueryRoute'
import { registerSaved, unregisterSaved } from '@/lib/searchQueryStore'

// 登録パターン (★) の口 (docs/59-検索候補計画.md §4, §7)。
//
//   PUT    … ☆ を押して登録する。満杯なら 409
//   DELETE … ★ を押して外す (外すと同時に履歴へ入る。searchQueryStore 参照)
//
// どちらも本文は { query }。DELETE に本文を持たせるのは、検索式に # や空白が
// 入るのでクエリ文字列に載せるより素直だから (エンコード漏れの余地が無い)。

export async function PUT(request: Request): Promise<NextResponse> {
  const user = await searchQueryUser(request)
  if (typeof user !== 'string') {
    return user
  }

  const query = (await readJsonObject(request))?.query
  if (!isRecordableQuery(query)) {
    return apiFail('リクエストの形式が正しくありません', 400)
  }

  const lists = await registerSaved(user, query)
  if (lists === null) {
    // 満杯。画面は ☆ を押せなくしているので普通は来ないが、2 台から同時に
    // 登録すれば起きうる。黙って捨てず、理由の分かる応答を返す
    return apiFail(`登録パターンは ${SAVED_LIMIT} 件までです`, 409)
  }
  return apiOk(lists)
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const user = await searchQueryUser(request)
  if (typeof user !== 'string') {
    return user
  }

  const query = (await readJsonObject(request))?.query
  if (!isRecordableQuery(query)) {
    return apiFail('リクエストの形式が正しくありません', 400)
  }

  return apiOk(await unregisterSaved(user, query))
}
