import { beforeEach, expect, test, vi } from 'vitest'

// newItemId は直前に振った時刻と連番をモジュールに持つ。テスト同士で
// 持ち越さないよう、毎回モジュールを読み直す
let newItemId: (now?: number) => string

beforeEach(async () => {
  vi.resetModules()
  ;({ newItemId } = await import('./itemId'))
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function hexOf(id: string): string {
  return id.replace(/-/g, '')
}

function timeOf(id: string): number {
  return parseInt(hexOf(id).slice(0, 12), 16)
}

function seqOf(id: string): number {
  return parseInt(hexOf(id).slice(13, 16), 16)
}

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)

test('UUID の小文字表記を返す', () => {
  expect(newItemId()).toMatch(UUID_PATTERN)
})

test('版は 7、variant は 10 (RFC 9562)', () => {
  for (let i = 0; i < 50; i++) {
    const hex = hexOf(newItemId(NOW + i))
    expect(hex[12]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(hex[16])
  }
})

test('先頭 48 bit が渡したミリ秒の時刻になる', () => {
  expect(timeOf(newItemId(NOW))).toBe(NOW)
})

test('時刻を渡さなければ今の時刻で振る', () => {
  const before = Date.now()
  const id = newItemId()
  const after = Date.now()
  expect(timeOf(id)).toBeGreaterThanOrEqual(before)
  expect(timeOf(id)).toBeLessThanOrEqual(after)
})

test('同じミリ秒の中では連番で単調に増える', () => {
  const ids = Array.from({ length: 100 }, () => newItemId(NOW))
  for (let i = 1; i < ids.length; i++) {
    expect(ids[i] > ids[i - 1]).toBe(true)
    expect(timeOf(ids[i])).toBe(NOW)
    expect(seqOf(ids[i])).toBe(seqOf(ids[i - 1]) + 1)
  }
})

test('新しいミリ秒の連番は上半分を空けて始まる', () => {
  for (let i = 0; i < 50; i++) {
    expect(seqOf(newItemId(NOW + i))).toBeLessThanOrEqual(0x7ff)
  }
})

test('文字列の順が時刻の順になる', () => {
  const earlier = newItemId(NOW)
  const later = newItemId(NOW + 1)
  const muchLater = newItemId(NOW + 86_400_000)
  expect([muchLater, earlier, later].sort()).toEqual([earlier, later, muchLater])
})

test('連番が溢れたら時刻を 1 ms 進め、順は崩さない', () => {
  // 始まりの連番は 0x7ff 以下なので、4097 回振れば必ず 1 回は溢れる
  const ids = Array.from({ length: 4097 }, () => newItemId(NOW))
  for (let i = 1; i < ids.length; i++) {
    expect(ids[i] > ids[i - 1]).toBe(true)
  }
  const last = ids[ids.length - 1]
  expect(timeOf(last)).toBe(NOW + 1)
  expect(new Set(ids).size).toBe(ids.length)
})

test('時計が戻っても直前より大きい id を返す', () => {
  const first = newItemId(NOW)
  const second = newItemId(NOW - 1000)
  expect(second > first).toBe(true)
  expect(timeOf(second)).toBe(NOW)
})

test('同じ時刻で振っても重複しない', () => {
  const ids = Array.from({ length: 1000 }, () => newItemId(NOW))
  expect(new Set(ids).size).toBe(1000)
})
