// 脆弱性の連絡先 (RFC 9116) の本文。
//
// Expires は必須で、先は 1 年未満が推奨 (§2.5.5)。手で書くと年に 1 回の
// 書き直しを忘れて切れるので、**ビルドした日から数える**。
// app/.well-known/security.txt/route.ts が force-static で、ビルド時に 1 回だけ
// これを呼ぶ。配布を続けていれば期限は延び続け、1 年配布しなければ切れて
// 「この連絡先は放置されている」と正しく伝わる。
//
// public/ の静的ファイルにしないのは、日付が変わるたびに 188MB のモデル群と
// 同じ層が変わって、配布のたびに丸ごと再送になるため (docs/80)。
// ルートの書き出し先は毎回変わる .next/server の層なので、増える転送は無い

import { QR_NOTE_GITHUB_URL, SECURITY_TXT_PATH } from './projectLinks'

export const SECURITY_TXT_VALID_DAYS = 365

const DAY_MS = 24 * 60 * 60 * 1000

// 本番とデモは同じイメージなので、両方の置き場を Canonical に並べる
const CANONICAL_ORIGINS = ['https://qr.tommie.jp', 'https://qr-demo.tommie.jp'] as const

export function buildSecurityTxt(builtAt: Date): string {
  const expires = new Date(builtAt.getTime() + SECURITY_TXT_VALID_DAYS * DAY_MS)
  const lines = [
    `Contact: ${QR_NOTE_GITHUB_URL}/security/advisories/new`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: ja, en',
    ...CANONICAL_ORIGINS.map((origin) => `Canonical: ${origin}${SECURITY_TXT_PATH}`),
  ]
  return `${lines.join('\n')}\n`
}
