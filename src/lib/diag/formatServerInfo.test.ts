import { expect, test } from 'vitest'
import { formatServerInfo } from './formatServerInfo'
import type { ServerInfo } from './types'

const INFO: ServerInfo = {
  collectedAt: new Date('2026-10-17T03:04:05Z'),
  overall: 'warn',
  checks: [
    { name: 'DB 応答', level: 'ok', detail: '12ms' },
    { name: 'スワップ (ホスト)', level: 'warn', detail: '使用 60%' },
  ],
  sections: [
    {
      id: 'host',
      title: 'ホスト',
      result: {
        kind: 'ok',
        rows: [
          { label: 'OS', value: 'Ubuntu 24.04.2 LTS' },
          { label: 'カーネル', value: '6.8.0' },
        ],
      },
    },
    {
      id: 'db',
      title: 'DB',
      result: { kind: 'failed', message: 'connect ECONNREFUSED' },
    },
  ],
}

test('判定 → 節の順に、ラベルと値を 1 行ずつ並べる', () => {
  // Act
  const text = formatServerInfo(INFO)

  // Assert
  expect(text).toBe(
    [
      '# サーバー情報 (2026/10/17 12:04:05)',
      '',
      '## ヘルスチェック: 注意',
      '[OK] DB 応答: 12ms',
      '[注意] スワップ (ホスト): 使用 60%',
      '',
      '## ホスト',
      'OS: Ubuntu 24.04.2 LTS',
      'カーネル: 6.8.0',
      '',
      '## DB',
      '取得できませんでした: connect ECONNREFUSED',
    ].join('\n'),
  )
})
