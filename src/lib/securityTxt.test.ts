import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { SECURITY_TXT_PATH } from './projectLinks'

// 脆弱性の連絡先 (RFC 9116)。静的ファイルで public/ に置く
const body = readFileSync(join(process.cwd(), 'public', SECURITY_TXT_PATH), 'utf8')

function field(name: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith(`${name}: `))
    .map((line) => line.slice(name.length + 2))
}

const DAY_MS = 24 * 60 * 60 * 1000

// Contact と Expires は RFC 9116 の必須項目
test('連絡先は GitHub の非公開の脆弱性報告', () => {
  expect(field('Contact')).toEqual(['https://github.com/tommie-jp/qr-note/security/advisories/new'])
})

// **このテストが落ちたら Expires を 1 年先へ書き直す。** 期限切れの
// security.txt は「もう連絡を受けていない」と読まれる (RFC 9116 §2.5.5)。
// 先の上限は 1 年未満が推奨
test('Expires が切れていない (1 年以内の先)', () => {
  const [expires] = field('Expires')
  const at = Date.parse(expires)
  expect(Number.isNaN(at)).toBe(false)
  expect(at).toBeGreaterThan(Date.now())
  expect(at - Date.now()).toBeLessThanOrEqual(366 * DAY_MS)
})

// 本番とデモは同じイメージなので、両方の置き場を Canonical に並べる
test('本番とデモの両方を Canonical に挙げる', () => {
  expect(field('Canonical')).toEqual([
    'https://qr.tommie.jp/.well-known/security.txt',
    'https://qr-demo.tommie.jp/.well-known/security.txt',
  ])
})
