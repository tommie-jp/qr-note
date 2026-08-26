import { afterEach, expect, test, vi } from 'vitest'
import { qrBaseUrl, qrStickerHost, siteBaseUrl, siteTitle } from './site'

const original = process.env.QR_BASE_URL
const originalAppEnv = process.env.APP_ENV
const originalDemo = process.env.DEMO_MODE

afterEach(() => {
  process.env.QR_BASE_URL = original
  if (originalAppEnv === undefined) {
    delete process.env.APP_ENV
  } else {
    process.env.APP_ENV = originalAppEnv
  }
  if (originalDemo === undefined) {
    delete process.env.DEMO_MODE
  } else {
    process.env.DEMO_MODE = originalDemo
  }
  vi.restoreAllMocks()
})

test('QR_BASE_URL をそのまま使う', () => {
  process.env.QR_BASE_URL = 'https://parts.example.com'
  expect(qrBaseUrl()).toBe('https://parts.example.com')
  expect(qrStickerHost()).toBe('parts.example.com')
})

test('未設定なら既定へ倒す', () => {
  delete process.env.QR_BASE_URL
  expect(qrStickerHost()).toBe('qr.tommie.jp')
})

test('空文字 (.env に `QR_BASE_URL=` と書いた形) でも既定へ倒す', () => {
  // ?? だとここで空文字が素通しされ、new URL('') が投げてトップpage が 500 になる
  process.env.QR_BASE_URL = ''
  expect(qrBaseUrl()).toBe('https://qr.tommie.jp')
  expect(qrStickerHost()).toBe('qr.tommie.jp')
})

// タブを並べているときは背景色が見えないため、誤認を防げるのはタイトルだけになる
test('本番のタイトルは素のサイト名', () => {
  process.env.APP_ENV = 'production'
  expect(siteTitle()).toBe('QR Note')
})

test('非本番のタイトルは [LOCAL] を冠する', () => {
  delete process.env.APP_ENV
  delete process.env.DEMO_MODE
  expect(siteTitle()).toBe('[LOCAL] QR Note')
})

// docs/38-デモモード計画.md §6。デモは本番相当で立てるので通常は [DEMO] だけ
test('デモの本番タイトルは [DEMO] を冠する', () => {
  process.env.APP_ENV = 'production'
  process.env.DEMO_MODE = '1'
  expect(siteTitle()).toBe('[DEMO] QR Note')
})

// [LOCAL] と [DEMO] は独立軸。ローカルでデモを検証するときは両方付く
test('ローカルでのデモは [LOCAL] [DEMO] を両方冠する', () => {
  delete process.env.APP_ENV
  process.env.DEMO_MODE = '1'
  expect(siteTitle()).toBe('[LOCAL] [DEMO] QR Note')
})

test('URL として壊れていても投げず、既定へ倒して警告する', () => {
  // scheme を書き忘れた形。印刷設定の不備で検索まで落とさない
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  process.env.QR_BASE_URL = 'qr.tommie.jp'
  expect(qrStickerHost()).toBe('qr.tommie.jp')
  expect(warn).toHaveBeenCalledOnce()
})

// OGP の metadataBase が読む口 (docs/89-OGP計画.md §3)
test('siteBaseUrl は QR_BASE_URL を URL として返す', () => {
  process.env.QR_BASE_URL = 'https://parts.example.com'
  expect(siteBaseUrl().href).toBe('https://parts.example.com/')
})

// **ここが投げると root layout の generateMetadata ごと落ちる** =
// ログイン画面を含む全ページが 500 になる。qrStickerHost と同じ扱いで守る
test('siteBaseUrl は URL として壊れていても投げず、既定へ倒す', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  process.env.QR_BASE_URL = 'qr.tommie.jp' // scheme 忘れ
  expect(() => siteBaseUrl()).not.toThrow()
  expect(siteBaseUrl().href).toBe('https://qr.tommie.jp/')
  expect(warn).toHaveBeenCalled()
})
