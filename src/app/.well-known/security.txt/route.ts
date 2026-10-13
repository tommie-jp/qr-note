import { buildSecurityTxt } from '@/lib/securityTxt'

// 脆弱性の連絡先 (RFC 9116)。Expires をビルドした日から数えるので、
// ビルド時に 1 回だけ作って書き出す (lib/securityTxt.ts)。
// リクエストのたびに作ると期限が永遠に先へ逃げ、放置されても切れない
export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(buildSecurityTxt(new Date()), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
