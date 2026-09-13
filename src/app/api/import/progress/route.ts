import type { NextResponse } from 'next/server'
import { denyCrossSite, denyIfDemoMode, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { apiOk } from '@/lib/route/respond'
import { currentImport } from '@/lib/zip/importProgressStore'

// 取り込みの進み具合を覗く (docs/28-エクスポート計画.md §9)。
//
// 取り込み中の POST とは**別の要求**で、控え (プロセス内の単一スロット) を
// 読むだけ。取り込んでいなければ data は null。
//
// **この口は proxy を通ってよい**。proxy が本文をメモリへ複製する問題
// (§3 実装結果) は本文を持つ要求の話で、こちらは GET なので無関係。
//
// 500ms ごとに叩かれるので、DB には触らない (触るとポーリングがそのまま
// 負荷になる)。
export async function GET(request: Request): Promise<NextResponse> {
  const denied =
    denyIfDemoMode() ?? (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  if (denied) {
    return denied
  }

  // 進み具合は一瞬で古くなる。中継にもブラウザにも溜めさせない (apiOk の既定の no-store)
  return apiOk(currentImport())
}
