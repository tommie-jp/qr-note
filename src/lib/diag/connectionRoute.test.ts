import { expect, test } from 'vitest'
import { classifyClientAddress, connectionSection, REAL_IP_HEADER } from './connectionRoute'

function headersWith(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

test.each([
  ['100.124.223.57', 'tailscale'],
  ['100.64.0.1', 'tailscale'],
  ['100.127.255.254', 'tailscale'],
  ['fd7a:115c:a1e0::8336:1764', 'tailscale'],
  ['FD7A:115C:A1E0:ab12::1', 'tailscale'],
  ['::ffff:100.125.23.99', 'tailscale'],
  ['127.0.0.1', 'host'],
  ['::1', 'host'],
  ['::ffff:127.0.0.1', 'host'],
  ['192.168.1.40', 'lan'],
  ['10.0.0.5', 'lan'],
  ['172.16.0.1', 'lan'],
  ['172.31.255.255', 'lan'],
  ['203.0.113.7', 'public'],
  ['100.63.255.255', 'public'],
  ['100.128.0.0', 'public'],
  ['172.32.0.1', 'public'],
  ['2001:db8::1', 'public'],
])('%s は %s と判定する', (address, expected) => {
  // Act
  const route = classifyClientAddress(address)

  // Assert
  expect(route).toBe(expected)
})

test.each([[null], [''], ['  '], ['not-an-ip'], ['999.1.1.1']])(
  '送信元が無い・読めない (%s) ときは unknown',
  (address) => {
    // Act
    const route = classifyClientAddress(address)

    // Assert
    expect(route).toBe('unknown')
  },
)

test('Tailscale 経由のとき、経路と送信元を節に出す', () => {
  // Arrange
  const headers = headersWith({ [REAL_IP_HEADER]: '100.124.223.57', host: 'qr.tommie.jp' })

  // Act
  const section = connectionSection(headers)

  // Assert
  expect(section.id).toBe('connection')
  expect(section.title).toBe('この接続')
  expect(section.result).toEqual({
    kind: 'ok',
    rows: [
      { label: '経路', value: 'Tailscale 経由' },
      { label: '送信元', value: '100.124.223.57' },
      { label: 'ホスト名', value: 'qr.tommie.jp' },
    ],
  })
})

test('公開側から来たときは、そうと分かる文言にする', () => {
  // Arrange
  const headers = headersWith({ [REAL_IP_HEADER]: '203.0.113.7', host: 'qr-demo.tommie.jp' })

  // Act
  const section = connectionSection(headers)

  // Assert
  expect(section.result.kind).toBe('ok')
  if (section.result.kind !== 'ok') return
  expect(section.result.rows[0]).toEqual({ label: '経路', value: 'インターネット (公開側)' })
})

test('X-Real-IP が無いときは「不明」と理由を出し、送信元は「なし」にする', () => {
  // Arrange (next dev を直に開いたときなど、nginx を通っていない)
  const headers = headersWith({ host: 'localhost:3000' })

  // Act
  const section = connectionSection(headers)

  // Assert
  expect(section.result).toEqual({
    kind: 'ok',
    rows: [
      { label: '経路', value: '不明 (nginx を通っていない)' },
      { label: '送信元', value: 'なし' },
      { label: 'ホスト名', value: 'localhost:3000' },
    ],
  })
})

test('送信元の値が長すぎる・壊れているときは、そのまま画面に出さない', () => {
  // Arrange
  const headers = headersWith({ [REAL_IP_HEADER]: 'x'.repeat(500) })

  // Act
  const section = connectionSection(headers)

  // Assert
  expect(section.result.kind).toBe('ok')
  if (section.result.kind !== 'ok') return
  expect(section.result.rows[1]).toEqual({ label: '送信元', value: '(読めない値)' })
  expect(section.result.rows[2]).toEqual({ label: 'ホスト名', value: 'なし' })
})
