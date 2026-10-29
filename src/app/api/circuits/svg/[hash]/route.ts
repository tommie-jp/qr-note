// 回路図の SVG を 1 枚配る (docs/124 §1)。一覧のサムネが hash で引く。
//
// **hash は回路の本文 (と描画器の版) から作る鍵**なので、同じ hash の中身は
// 変わらない。だから immutable で 1 年覚えさせ、2 回目からは要求そのものを
// 出させない。中身を軽くし直す (scripts/optimizeCircuitSvgs.ts) ことはあるが、
// 見た目は同じなので、前の版を覚えたままでも困らない。
//
// private … ログインの要る口なので、共有のキャッシュ (nginx・中継) には置かせない。
// 配る前に毎回安全検査を掛ける (描画済みの控えを読む他の口と同じ)。
// 開いても動かないよう、SVG の中のスクリプトを止める CSP を付ける
// (検査で既に断っているが、口を開けたので念のため二重にする)
import type { NextResponse } from 'next/server'
import { assertSafeCircuitSvg } from '@/lib/circuit/hash'
import { prisma } from '@/lib/db'
import { compressedTextResponse } from '@/lib/route/compress'
import { guardRequest } from '@/lib/route/guard'
import { BAD_REQUEST_MESSAGE } from '@/lib/route/parse'
import { apiFail } from '@/lib/route/respond'

const HASH = /^[0-9a-f]{64}$/
const YEAR_SECONDS = 365 * 24 * 60 * 60

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hash: string }> },
): Promise<NextResponse> {
  const guard = await guardRequest(request, { demo: 'allow' })
  if (!guard.ok) {
    return guard.response
  }
  const { hash } = await params
  if (!HASH.test(hash)) {
    return apiFail(BAD_REQUEST_MESSAGE, 400)
  }
  const row = await prisma.circuitSvg.findUnique({ where: { hash }, select: { svg: true } }).catch(
    (error: unknown) => {
      console.error(`回路図の SVG を引けませんでした (${hash})`, error)
      return undefined
    },
  )
  if (row === undefined) {
    return apiFail('回路図を読み込めませんでした', 500)
  }
  if (row === null) {
    // 未描画。覚えさせない (描けたら同じ hash で出るようになる)
    return apiFail('回路図はまだ描かれていません', 404)
  }
  let svg: string
  try {
    svg = assertSafeCircuitSvg(row.svg)
  } catch {
    return apiFail('回路図を配れません', 404)
  }
  return compressedTextResponse(svg, request, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': `private, max-age=${YEAR_SECONDS}, immutable`,
    'X-Content-Type-Options': 'nosniff',
    // sandbox … 直に開いても別の生まれ (opaque origin) の文書として扱わせる。
    // 検査や CSP に穴があっても、このアプリの cookie や画面に触れない (docs/124 §1)
    'Content-Security-Policy':
      "sandbox; default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; frame-ancestors 'none'",
  })
}
