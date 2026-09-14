import { expect, test } from 'vitest'
import {
  CLIENT_LOG_MAX_BATCH,
  deviceLabel,
  parseClientLogPayload,
} from './clientPayload'
import { LOG_TEXT_LIMIT } from './entry'

// 受け口の検証 (docs/30-ブラウザログ計画.md §5)。外から来るデータは信じない

test('妥当な本文は項目の配列になる', () => {
  const items = parseClientLogPayload({
    items: [
      { level: 'warn', text: 'モデルを読み込めませんでした' },
      { level: 'error', text: '未捕捉の例外: null is not an object' },
    ],
  })

  expect(items).toEqual([
    { level: 'warn', text: 'モデルを読み込めませんでした' },
    { level: 'error', text: '未捕捉の例外: null is not an object' },
  ])
})

test('受ける側でも 2000 文字で切る (送る側の上限は書き換えられる)', () => {
  const items = parseClientLogPayload({
    items: [{ level: 'warn', text: 'あ'.repeat(LOG_TEXT_LIMIT + 100) }],
  })

  expect(items?.[0].text).toHaveLength(LOG_TEXT_LIMIT)
})

test.each([
  ['本文が JSON の値でない', 'ログ'],
  ['items が無い', {}],
  ['items が配列でない', { items: 'ログ' }],
  ['items が空', { items: [] }],
  ['level が info / warn / error でない', { items: [{ level: 'debug', text: 'ログ' }] }],
  ['text が文字列でない', { items: [{ level: 'warn', text: 42 }] }],
  ['text が空', { items: [{ level: 'warn', text: '' }] }],
  ['項目がオブジェクトでない', { items: ['ログ'] }],
])('形が違えば断る: %s', (_name, body) => {
  expect(parseClientLogPayload(body)).toBeNull()
})

test('info (診断イベント) も受け付ける', () => {
  // Arrange
  const body = { items: [{ level: 'info', text: '[OCR] Worker 起動' }] }

  // Act
  const items = parseClientLogPayload(body)

  // Assert
  expect(items).toEqual([{ level: 'info', text: '[OCR] Worker 起動' }])
})

test('1 回の件数の上限を超えたら断る', () => {
  const item = { level: 'warn', text: 'ログ' }
  const withinLimit = { items: Array.from({ length: CLIENT_LOG_MAX_BATCH }, () => item) }
  const overLimit = { items: Array.from({ length: CLIENT_LOG_MAX_BATCH + 1 }, () => item) }

  expect(parseClientLogPayload(withinLimit)).toHaveLength(CLIENT_LOG_MAX_BATCH)
  expect(parseClientLogPayload(overLimit)).toBeNull()
})

test('1 件でも形が違えば全部断る (部分的に受けると「送ったのに出ない」が起きる)', () => {
  const body = {
    items: [
      { level: 'warn', text: '正しい' },
      { level: 'debug', text: '不正' },
    ],
  }

  expect(parseClientLogPayload(body)).toBeNull()
})

test.each([
  ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15'],
  ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15'],
  ['Android', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36'],
  ['PC', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
])('User-Agent から端末の印を採る: %s', (label, userAgent) => {
  expect(deviceLabel(userAgent)).toBe(label)
})

test('User-Agent が無ければ「不明」', () => {
  expect(deviceLabel(null)).toBe('不明')
  expect(deviceLabel('')).toBe('不明')
})
