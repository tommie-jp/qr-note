import { expect, test } from 'vitest'
import {
  evaluateHealth,
  type HealthInputs,
  overallLevel,
} from './healthChecks'

const GB = 1024 ** 3

// 全部が健全な入力。各テストはここから 1 か所だけ崩す
const HEALTHY: HealthInputs = {
  db: {
    kind: 'ok',
    pingMs: 12,
    pgroongaVersion: '4.1.0',
    pgroongaIndexes: ['items_memo_pgroonga_idx'],
    brokenMigrations: 0,
  },
  gitRepo: { kind: 'ok' },
  memory: {
    totalBytes: 2 * GB,
    availableBytes: 0.75 * GB,
    swapTotalBytes: 2 * GB,
    swapFreeBytes: 1.5 * GB,
  },
  disk: { totalBytes: 40 * GB, freeBytes: 20 * GB },
  errorLogCount: 0,
  rakutenSet: 3,
  webauthnSet: 2,
}

function levelOf(inputs: HealthInputs, name: string) {
  const check = evaluateHealth(inputs).find((c) => c.name === name)
  if (!check) {
    throw new Error(`check not found: ${name}`)
  }
  return check
}

test('健全な入力では全行 OK で、全体も OK', () => {
  // Act
  const checks = evaluateHealth(HEALTHY)

  // Assert
  expect(checks.length).toBeGreaterThanOrEqual(11)
  expect(checks.every((c) => c.level === 'ok')).toBe(true)
  expect(overallLevel(checks)).toBe('ok')
})

test('DB 応答は 200ms 以上で注意、失敗なら異常', () => {
  expect(
    levelOf({ ...HEALTHY, db: { ...HEALTHY.db, pingMs: 200 } as never }, 'DB 応答')
      .level,
  ).toBe('warn')
  const failed = levelOf(
    { ...HEALTHY, db: { kind: 'failed', message: 'connect ECONNREFUSED' } },
    'DB 応答',
  )
  expect(failed.level).toBe('error')
  expect(failed.detail).toContain('ECONNREFUSED')
})

test('DB に届かないときは DB 由来の他の行も異常にする (不明を OK に見せない)', () => {
  // Arrange
  const inputs: HealthInputs = {
    ...HEALTHY,
    db: { kind: 'failed', message: 'timeout' },
  }

  // Act
  const checks = evaluateHealth(inputs)

  // Assert
  for (const name of ['PGroonga 拡張', 'PGroonga 索引', 'マイグレーション']) {
    expect(checks.find((c) => c.name === name)?.level).toBe('error')
  }
})

test('PGroonga 拡張が無ければ異常', () => {
  const check = levelOf(
    { ...HEALTHY, db: { ...HEALTHY.db, pgroongaVersion: null } as never },
    'PGroonga 拡張',
  )
  expect(check.level).toBe('error')
})

test('PGroonga 索引が 0 本なら異常 (全文検索が seq scan に落ちている)', () => {
  const check = levelOf(
    { ...HEALTHY, db: { ...HEALTHY.db, pgroongaIndexes: [] } as never },
    'PGroonga 索引',
  )
  expect(check.level).toBe('error')
  expect(check.detail).toContain('seq scan')
})

test('PGroonga 索引が有れば本数と名前を添える', () => {
  const check = levelOf(HEALTHY, 'PGroonga 索引')
  expect(check.level).toBe('ok')
  expect(check.detail).toContain('items_memo_pgroonga_idx')
})

test('未完・巻き戻しのマイグレーションがあれば異常', () => {
  const check = levelOf(
    { ...HEALTHY, db: { ...HEALTHY.db, brokenMigrations: 1 } as never },
    'マイグレーション',
  )
  expect(check.level).toBe('error')
})

test('ノートの git 置き場が読めなければ注意', () => {
  const check = levelOf(
    { ...HEALTHY, gitRepo: { kind: 'failed', message: 'ENOENT' } },
    'ノートの git 置き場',
  )
  expect(check.level).toBe('warn')
  expect(check.detail).toContain('ENOENT')
})

test('ノートの git 置き場が未初期化 (初回書き込み前) なら OK', () => {
  const check = levelOf({ ...HEALTHY, gitRepo: { kind: 'uninitialized' } }, 'ノートの git 置き場')
  expect(check.level).toBe('ok')
  expect(check.detail).toContain('未初期化')
})

test('利用可能メモリが 15% 未満なら注意、読めなければ注意', () => {
  expect(
    levelOf(
      { ...HEALTHY, memory: { ...HEALTHY.memory!, availableBytes: 0.2 * GB } },
      'メモリ (ホスト)',
    ).level,
  ).toBe('warn')
  expect(levelOf({ ...HEALTHY, memory: null }, 'メモリ (ホスト)').level).toBe(
    'warn',
  )
})

test('スワップの使用が 50% 以上なら注意、スワップ無しは OK', () => {
  expect(
    levelOf(
      { ...HEALTHY, memory: { ...HEALTHY.memory!, swapFreeBytes: 0.9 * GB } },
      'スワップ (ホスト)',
    ).level,
  ).toBe('warn')
  expect(
    levelOf(
      {
        ...HEALTHY,
        memory: { ...HEALTHY.memory!, swapTotalBytes: 0, swapFreeBytes: 0 },
      },
      'スワップ (ホスト)',
    ).level,
  ).toBe('ok')
})

test('データ領域の空きが 10% 未満なら注意', () => {
  expect(
    levelOf(
      { ...HEALTHY, disk: { totalBytes: 40 * GB, freeBytes: 3 * GB } },
      'データ領域の空き',
    ).level,
  ).toBe('warn')
  expect(levelOf({ ...HEALTHY, disk: null }, 'データ領域の空き').level).toBe(
    'warn',
  )
})

test('直近のサーバログに error があれば件数つきで注意', () => {
  const check = levelOf({ ...HEALTHY, errorLogCount: 3 }, '直近のサーバログ')
  expect(check.level).toBe('warn')
  expect(check.detail).toContain('3')
})

test('楽天は 3 つ揃い・全部無しが OK、一部だけなら注意', () => {
  expect(levelOf({ ...HEALTHY, rakutenSet: 0 }, '楽天の設定').level).toBe('ok')
  expect(levelOf({ ...HEALTHY, rakutenSet: 2 }, '楽天の設定').level).toBe('warn')
})

test('パスキーは 2 つ揃い・全部無しが OK、一部だけなら注意', () => {
  expect(levelOf({ ...HEALTHY, webauthnSet: 0 }, 'パスキーの設定').level).toBe(
    'ok',
  )
  expect(levelOf({ ...HEALTHY, webauthnSet: 1 }, 'パスキーの設定').level).toBe(
    'warn',
  )
})

test('全体は最悪の行に揃う', () => {
  expect(
    overallLevel([
      { name: 'a', level: 'ok', detail: '' },
      { name: 'b', level: 'warn', detail: '' },
    ]),
  ).toBe('warn')
  expect(
    overallLevel([
      { name: 'a', level: 'warn', detail: '' },
      { name: 'b', level: 'error', detail: '' },
    ]),
  ).toBe('error')
  expect(overallLevel([])).toBe('ok')
})
