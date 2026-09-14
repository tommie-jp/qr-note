import { expect, test } from 'vitest'
import { resolveScanPath } from './scanResult'

// シールに焼かれたホスト (QR_BASE_URL) と、いま開いているホスト。
// 実機確認では localhost や LAN の IP でアプリを開きつつ
// qr.tommie.jp のシールを読むので、両方を部品 URL と認める
const HOSTS = ['qr.tommie.jp', 'localhost']
const HOST = 'qr.tommie.jp'

test('自サイトの部品 URL は部品ページへ飛ばす', () => {
  expect(resolveScanPath('https://qr.tommie.jp/item/1003', HOSTS)).toBe('/item/1003')
})

test('localhost で開いていてもシール (qr.tommie.jp) を部品ページへ飛ばす', () => {
  // ここが現在ホストだけの判定だと、実機確認で黙って検索に落ちて 0 件になる
  expect(resolveScanPath('http://qr.tommie.jp/item/1003', ['qr.tommie.jp', 'localhost'])).toBe(
    '/item/1003',
  )
})

test('いま開いているホストの部品 URL も飛ばす', () => {
  expect(resolveScanPath('http://localhost:3001/item/1003', HOSTS)).toBe('/item/1003')
})

test('旧シールの http URL も部品ページへ飛ばす (スキームは見ない)', () => {
  // Ver1 のシールには http:// が焼き込まれている (41-QR-search/docs/02-Ver1調査.md)。
  // https 化後もシールは貼り替えられないので、ここが通らないと実物が読めない
  expect(resolveScanPath('http://qr.tommie.jp/item/1003', [HOST])).toBe('/item/1003')
})

test('非数字の itemNo も部品ページへ飛ばす', () => {
  // Ver1 実データに "100x" 形式が 1 件ある (validation.ts)
  expect(resolveScanPath('https://qr.tommie.jp/item/100x', [HOST])).toBe('/item/100x')
})

test('末尾スラッシュ付きでも部品ページへ飛ばす', () => {
  expect(resolveScanPath('https://qr.tommie.jp/item/1003/', [HOST])).toBe('/item/1003')
})

test('外部サイトの URL は開かずに検索に落とす', () => {
  // カメラにたまたま写った QR で外部へ飛ばされないようにする
  expect(resolveScanPath('https://example.com/evil', [HOST])).toBe(
    '/?q=https%3A%2F%2Fexample.com%2Fevil',
  )
})

test('自サイトを名乗る紛らわしいホストは外部として扱う', () => {
  expect(resolveScanPath('https://qr.tommie.jp.evil.com/item/1003', [HOST])).toBe(
    '/?q=https%3A%2F%2Fqr.tommie.jp.evil.com%2Fitem%2F1003',
  )
})

test('javascript: の QR は検索に落とす', () => {
  // URL としてパースは通る (hostname が空) が、自サイトではないので検索行き
  expect(resolveScanPath('javascript:alert(1)', [HOST])).toBe('/?q=javascript%3Aalert%281%29')
})

test('ISBN バーコードは検索に落とす', () => {
  expect(resolveScanPath('9784873115658', [HOST])).toBe('/?q=9784873115658')
})

test('任意テキストの QR は検索に落とす', () => {
  expect(resolveScanPath('2SC2712-Y', [HOST])).toBe('/?q=2SC2712-Y')
})

test('自サイトでも部品ページ以外の URL は検索に落とす', () => {
  expect(resolveScanPath('https://qr.tommie.jp/docs/search', [HOST])).toBe(
    '/?q=https%3A%2F%2Fqr.tommie.jp%2Fdocs%2Fsearch',
  )
})

test('path traversal を仕込んだ自サイト URL は部品ページへ飛ばさない', () => {
  // URL のパース時に pathname が /evil へ正規化され /item/:itemNo に
  // マッチしなくなるので検索に落ちる。検索語は読み取った生の文字列
  // (何を読んだか人に見せる) であって、正規化後の URL ではない
  expect(resolveScanPath('https://qr.tommie.jp/item/1003/../../evil', [HOST])).toBe(
    '/?q=https%3A%2F%2Fqr.tommie.jp%2Fitem%2F1003%2F..%2F..%2Fevil',
  )
})

test('itemNo が不正な自サイト URL は検索に落とす', () => {
  expect(resolveScanPath('https://qr.tommie.jp/item/%20', [HOST])).toBe(
    '/?q=https%3A%2F%2Fqr.tommie.jp%2Fitem%2F%2520',
  )
})

test('壊れた %シーケンスの URL でも落ちずに検索に落とす', () => {
  // new URL() はこれを通してしまい、decodeURIComponent が URIError を投げる。
  // スキャンのコールバックは他人の作った QR で呼ばれるので、投げさせない
  expect(resolveScanPath('https://qr.tommie.jp/item/%E0%A4%A', [HOST])).toBe(
    '/?q=https%3A%2F%2Fqr.tommie.jp%2Fitem%2F%25E0%25A4%25A',
  )
})

test('空文字・空白だけの読み取りは無視する', () => {
  expect(resolveScanPath('', [HOST])).toBeNull()
  expect(resolveScanPath('   ', [HOST])).toBeNull()
})

test('前後の空白は落として判定する', () => {
  expect(resolveScanPath('  https://qr.tommie.jp/item/1003  ', [HOST])).toBe('/item/1003')
  expect(resolveScanPath('  9784873115658 ', [HOST])).toBe('/?q=9784873115658')
})
