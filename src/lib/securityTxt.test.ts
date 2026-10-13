import { expect, test } from 'vitest'
import { buildSecurityTxt, SECURITY_TXT_VALID_DAYS } from './securityTxt'

// 脆弱性の連絡先 (RFC 9116)。Expires はビルドした日から決まる
// (app/.well-known/security.txt/route.ts が force-static で書き出す)
const BUILT_AT = new Date('2026-10-14T05:00:00.000Z')
const body = buildSecurityTxt(BUILT_AT)

function field(name: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith(`${name}: `))
    .map((line) => line.slice(name.length + 2))
}

// Contact と Expires は RFC 9116 の必須項目
test('連絡先は GitHub の非公開の脆弱性報告', () => {
  expect(field('Contact')).toEqual(['https://github.com/tommie-jp/qr-note/security/advisories/new'])
})

// 配布のたびに延びる。1 年配布しなければ切れて「放置されている」と伝わる
test('Expires はビルドした日の 1 年後 (RFC の推奨どおり 1 年以内)', () => {
  expect(field('Expires')).toEqual(['2027-10-14T05:00:00.000Z'])
  expect(SECURITY_TXT_VALID_DAYS).toBeLessThanOrEqual(365)
})

// 本番とデモは同じイメージなので、両方の置き場を Canonical に並べる
test('本番とデモの両方を Canonical に挙げる', () => {
  expect(field('Canonical')).toEqual([
    'https://qr.tommie.jp/.well-known/security.txt',
    'https://qr-demo.tommie.jp/.well-known/security.txt',
  ])
})

test('行末は LF で、最後の行も改行で終わる', () => {
  expect(body).not.toContain('\r')
  expect(body.endsWith('\n')).toBe(true)
})
