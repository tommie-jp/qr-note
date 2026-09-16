// 事前入力のための外部照会の口 (api/books/[isbn]・api/products/[jan]) の骨格
// (docs/93-リファクタリング計画.md §3-3)。
//
// 2 つの口は「門番 → (デモ) → コードの検算 → 照会 → 投げたら 502」まで同じ形で、
// 違うのは検算・照会先・文言だけ。骨格を 1 本にしておくと、片方の門番だけ
// 直して穴が開くことがない (api/lookup.test.ts が 2 つを対で試している)。
//
// 応答はどれも no-store (respond.ts の既定)。

import type { NextResponse } from 'next/server'
import { isDemoMode } from '@/lib/appEnv'
import { guardRequest } from './guard'
import { apiDemoDisabled, apiFail, apiOk } from './respond'

export interface ExternalLookupSpec<K extends string> {
  // URL のどの動的セグメントがコードか ([isbn] なら 'isbn')
  readonly param: K
  // 外から来る値なので必ず検算する。通ったものだけを外部 API の URL に載せる
  readonly isValidCode: (code: string) => boolean
  readonly invalidCodeMessage: string
  // あれば、デモでは照会せずにこの文言で demoDisabled を返す (検算より前)
  readonly demoDisabledMessage?: string
  // 見つからないときは null を返す。それはエラーではない (data: null の 200)
  readonly lookup: (code: string) => Promise<unknown>
  // 照会が投げたときの 502 の文言。サーバログにも同じ文言で残す
  readonly failureMessage: string
}

export async function externalLookup<K extends string>(
  request: Request,
  params: Promise<Readonly<Record<K, string>>>,
  spec: ExternalLookupSpec<K>,
): Promise<NextResponse> {
  // デモでも門は開けておく。デモでどうするかは demoDisabledMessage で口が決める
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }

  if (spec.demoDisabledMessage !== undefined && isDemoMode()) {
    return apiDemoDisabled(spec.demoDisabledMessage)
  }

  const code = (await params)[spec.param]
  if (!spec.isValidCode(code)) {
    return apiFail(spec.invalidCodeMessage, 400)
  }

  try {
    return apiOk(await spec.lookup(code), 200)
  } catch (err) {
    // 想定外の失敗。中身 (外部 API の応答や例外の文言) は返さずログに残す
    console.error(spec.failureMessage, err)
    return apiFail(spec.failureMessage, 502)
  }
}
