import { beforeEach, describe, expect, test, vi } from 'vitest'

// 添付配信の「DB をどう引くか」の回帰 (2026-11 の監査 M-10 / M-11)。
// 実 DB の往復は images.test.ts が見る。ここは prisma を差し替えて、
//   - 未ログインで無い名前は position() の走査 (isPublicImageName) に届かない
//   - Range 要求は全体 (data) を読まず、長さと範囲だけを SQL で切り出す
// を見る
const mocks = vi.hoisted(() => ({
  user: 'tommie' as string | null,
  rows: new Map<string, { mime: string; data: Uint8Array }>(),
  findUniqueCalls: [] as unknown[],
  rawSql: [] as string[],
  isPublic: vi.fn(async (_name: string) => true),
}))

vi.mock('@/lib/auth/session', () => ({
  currentUser: async () => mocks.user,
}))
vi.mock('@/lib/items/read', () => ({
  isPublicImageName: (name: string) => mocks.isPublic(name),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    image: {
      findUnique: async (args: { where: { name: string }; select: Record<string, boolean> }) => {
        mocks.findUniqueCalls.push(args)
        const row = mocks.rows.get(args.where.name)
        if (row === undefined) return null
        return args.select.data ? { mime: row.mime, data: row.data } : { name: args.where.name }
      },
    },
    // タグ付きテンプレートの SQL を文字列に戻して覚え、octet_length / substring に応える
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      mocks.rawSql.push(sql)
      const name = values[values.length - 1] as string
      const row = mocks.rows.get(name)
      if (row === undefined) return []
      if (sql.includes('octet_length')) {
        return [{ mime: row.mime, size: row.data.byteLength }]
      }
      if (sql.includes('substring')) {
        const from = values[0] as number
        const length = values[1] as number
        return [{ chunk: row.data.subarray(from - 1, from - 1 + length) }]
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  },
}))

const { GET, HEAD } = await import('./route')

const NAME = '0f6f3d6e-5a1b-7c2d-8e9f-0a1b2c3d4e5f.wav'
const BYTES = new Uint8Array(Array.from({ length: 64 }, (_, i) => i))

function request(headers: Record<string, string> = {}) {
  return [
    new Request(`http://localhost/api/images/${NAME}`, { headers }),
    { params: Promise.resolve({ name: NAME }) },
  ] as const
}

beforeEach(() => {
  mocks.user = 'tommie'
  mocks.rows.clear()
  mocks.rows.set(NAME, { mime: 'audio/wav', data: BYTES })
  mocks.findUniqueCalls.length = 0
  mocks.rawSql.length = 0
  mocks.isPublic.mockClear()
})

describe('未ログインの門 (M-10)', () => {
  beforeEach(() => {
    mocks.user = null
  })

  test('無い名前は items を走査せずに 401 (存在の有無を教えない)', async () => {
    mocks.rows.clear()
    const res = await GET(...request())
    expect(res.status).toBe(401)
    expect(mocks.isPublic).not.toHaveBeenCalled()
  })

  test('ある名前だけ公開ノートかを引く', async () => {
    const res = await GET(...request())
    expect(res.status).toBe(200)
    expect(mocks.isPublic).toHaveBeenCalledWith(NAME)
  })

  test('あるが公開ノートに無ければ 401', async () => {
    mocks.isPublic.mockResolvedValueOnce(false)
    expect((await GET(...request())).status).toBe(401)
  })
})

describe('Range は DB で切り出す (M-11)', () => {
  test('206: 長さを取り、必要な範囲だけ substring で読む', async () => {
    const res = await GET(...request({ range: 'bytes=10-19' }))

    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 10-19/64')
    expect(res.headers.get('content-type')).toBe('audio/wav')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.subarray(10, 20))
    // 全体 (select data) は読んでいない
    expect(mocks.findUniqueCalls.some((c) => (c as { select: { data?: boolean } }).select.data)).toBe(
      false,
    )
    expect(mocks.rawSql.some((sql) => sql.includes('octet_length'))).toBe(true)
    expect(mocks.rawSql.some((sql) => sql.includes('substring'))).toBe(true)
  })

  test('416: 範囲外も全体を読まない', async () => {
    const res = await GET(...request({ range: 'bytes=100-200' }))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */64')
    expect(mocks.rawSql.some((sql) => sql.includes('substring'))).toBe(false)
  })

  test('読めない Range は全体を 200 で返す', async () => {
    const res = await GET(...request({ range: 'items=1-2' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect((await res.arrayBuffer()).byteLength).toBe(64)
  })

  test('HEAD は長さだけ返し、本文を読まない', async () => {
    const res = await HEAD(...request())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('64')
    expect(mocks.findUniqueCalls.some((c) => (c as { select: { data?: boolean } }).select.data)).toBe(
      false,
    )
  })
})
