import { expect, test } from 'vitest'
import { isCrossSiteRequest } from './crossSite'

const request = (headers?: Record<string, string>) =>
  new Request('http://localhost/api/books/9784873115658', { headers })

test('自分のページからの fetch は通す', () => {
  // usePrefill が送るもの
  expect(isCrossSiteRequest(request({ 'sec-fetch-site': 'same-origin' }))).toBe(false)
})

test('人が URL を直接開いたもの (none) は通す', () => {
  // アドレス欄・ブックマーク。第三者のページからは起こせない
  expect(isCrossSiteRequest(request({ 'sec-fetch-site': 'none' }))).toBe(false)
})

test('第三者のページからの呼び出しは断る', () => {
  // 悪意あるページの <img src="https://qr.tommie.jp/api/books/…">。
  // Basic 認証は SameSite が効かず、ブラウザが認証情報を付けてしまう
  expect(isCrossSiteRequest(request({ 'sec-fetch-site': 'cross-site' }))).toBe(true)
})

test('別のサブドメインからの呼び出しも断る', () => {
  // このアプリの口を呼ぶのは自分のページだけ
  expect(isCrossSiteRequest(request({ 'sec-fetch-site': 'same-site' }))).toBe(true)
})

test('ヘッダを送らない相手 (curl・古いブラウザ) は通す', () => {
  // 防ぎたいのは「認証情報を持ったブラウザが第三者に動かされること」で、
  // それができるブラウザは必ず Sec-Fetch-Site を送る。ここを閉じても
  // 鍵を持つ相手は自分でヘッダを付けられるので、守りは増えず確認だけが不便になる
  expect(isCrossSiteRequest(request())).toBe(false)
})

test('知らない値は断る (既定は閉じる側)', () => {
  // 将来ブラウザが値を増やしても、素通しではなく断る側へ倒す
  expect(isCrossSiteRequest(request({ 'sec-fetch-site': 'unknown-future-value' }))).toBe(true)
})
